import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DomainService } from '../domain/domain.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private domainService: DomainService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    let tenantId: string | undefined;
    let detectedFrom = 'unknown';

    // Method 1: Extract from hostname (Direct API calls or fallback) - HIGHEST PRIORITY
    // We check this FIRST to ensure strict domain isolation. If the request comes to a specific 
    // store domain (e.g. mystore.com), we MUST use that store's context.
    if (!tenantId) {
      const hostname = req.headers.host;
      if (hostname) {
        // Remove port if present
        const cleanHostname = hostname.split(':')[0];
        tenantId = await this.resolveTenantFromDomain(cleanHostname);
        if (tenantId) {
          detectedFrom = `host:${cleanHostname}`;
        }
      }
    }

    // Method 2: Extract from X-Tenant-Domain header (Frontend explicit domain)
    if (!tenantId) {
      const tenantDomainHeader = req.headers['x-tenant-domain'] as string;
      if (tenantDomainHeader) {
        // Use the logic to resolve from domain string
        tenantId = await this.resolveTenantFromDomain(tenantDomainHeader);
        if (tenantId) {
          detectedFrom = `header:${tenantDomainHeader}`;
        }
      }
    }

    // Method 2.5: Infer tenant from Origin/Referer host for localhost API calls.
    // This covers cases where frontend requests omit X-Tenant-Domain but are sent
    // from subdomain contexts like testico.localhost:8080 -> localhost:3002.
    if (!tenantId) {
      const apiHost = (req.headers.host || '').toLowerCase();
      const isLocalApiHost =
        apiHost.startsWith('localhost') ||
        apiHost.startsWith('127.0.0.1') ||
        apiHost.endsWith('.localhost:3002');

      if (isLocalApiHost) {
        const origin = (req.headers.origin as string | undefined) || '';
        const referer = (req.headers.referer as string | undefined) || '';
        const sourceUrl = origin || referer;

        if (sourceUrl) {
          try {
            const sourceHost = new URL(sourceUrl).hostname;
            tenantId = await this.resolveTenantFromDomain(sourceHost);
            if (tenantId) {
              detectedFrom = `origin:${sourceHost}`;
            }
          } catch {
            // Ignore malformed origin/referer and continue with other methods.
          }
        }
      }
    }

    // Method 3: Explicit tenant ID header from frontend (Fallback/Dashboard usage)
    if (!tenantId) {
      const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
      if (headerTenantId && headerTenantId !== 'default' && headerTenantId !== 'system') {
        tenantId = headerTenantId;
        detectedFrom = 'header:x-tenant-id';
      }
    }

    // Method 4: Extract from JWT token (API requests) - LOWEST PRIORITY (Fallback)
    // Only check JWT if tenant is NOT yet identified by other means
    if (!tenantId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const secret = this.configService.get<string>('JWT_SECRET');
          if (secret) {
            const payload = this.jwtService.verify(token, { secret });
            if (payload.tenantId) {
              tenantId = payload.tenantId;
              detectedFrom = 'jwt';
            }
          }
        } catch (error) {
          // Token verification failed, continue to other methods
        }
      }
    }

    // Attach tenant context to request
    if (tenantId) {
      // SECURITY FIX: If tenantId is encrypted (long hex string), decrypt it
      // This ensures consistency across services even if app-auth sends encrypted IDs
      let finalTenantId = tenantId;
      try {
        const { EncryptionUtil } = require('../utils/encryption.util');
        if (EncryptionUtil.isEncrypted(tenantId)) {
          const decrypted = EncryptionUtil.decryptDeterministic(tenantId);
          if (decrypted && decrypted !== tenantId) {
            this.logger.log(`🔓 Decrypted tenantId: ${tenantId.substring(0, 10)}... -> ${decrypted}`);
            finalTenantId = decrypted;
          }
        }
      } catch (e) {
        this.logger.warn(`⚠️ Failed to decrypt tenantId ${tenantId.substring(0, 10)}...: ${(e as Error).message}`);
      }

      (req as any).tenantId = finalTenantId;
      (req as any).tenantDetectedFrom = detectedFrom;
    }

    next();
  }

  private async resolveTenantFromDomain(hostname: string): Promise<string | undefined> {
    // Check if it's a custom domain
    const domainInfo = await this.domainService.getDomainByHostname(hostname);
    if (domainInfo) {
      return domainInfo.tenantId;
    }

    // Check if it's a subdomain
    const subdomain = this.extractSubdomain(hostname);
    if (subdomain) {
      // Look up the tenant by subdomain
      const tenantId = await this.domainService.findTenantBySubdomain(subdomain);
      return tenantId || undefined;
    }

    return undefined;
  }

  private extractSubdomain(hostname: string): string | null {
    const normalizedHostname = hostname.toLowerCase().split(':')[0];
    
    // Handle localhost and localhost.com (common in local dev with custom domains)
    if (normalizedHostname.endsWith('.localhost')) {
      return normalizedHostname.replace('.localhost', '');
    }
    if (normalizedHostname.endsWith('.localhost.com')) {
      return normalizedHostname.replace('.localhost.com', '');
    }
    
    // Handle nip.io domains for local development with mobile apps
    // e.g., store.192.168.1.32.nip.io -> "store"
    // e.g., asus130.192.168.1.32.nip.io -> "asus130"
    if (normalizedHostname.endsWith('.nip.io')) {
      // Pattern: subdomain.IP.nip.io where IP is like 192.168.1.32 (4 octets)
      // We want to extract everything BEFORE the IP
      const nipIoPattern = /^([a-z0-9-]+)\.(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\.nip\.io$/;
      const match = normalizedHostname.match(nipIoPattern);
      if (match && match[1]) {
        return match[1]; // The subdomain part (before the IP)
      }
      return null;
    }
    
    // Dynamic Domain Resolution
    const platformDomain = this.configService.get<string>('PLATFORM_DOMAIN') || 'kounworld.com';
    const secondaryDomain = this.configService.get<string>('PLATFORM_SECONDARY_DOMAIN') || 'saeaa.net';
    const secondaryDomainAliases = Array.from(
      new Set([
        secondaryDomain,
        // Local/dev setups often use saeaa.com even when env secondary is saeaa.net.
        // Accept both to avoid losing tenant context.
        'saeaa.com',
      ]),
    );
    
    // Handle main domains - should NOT be treated as subdomain
    const mainDomains = [
      platformDomain,
      `www.${platformDomain}`,
      `app.${platformDomain}`,
      ...secondaryDomainAliases,
      ...secondaryDomainAliases.map((domain) => `www.${domain}`),
      ...secondaryDomainAliases.map((domain) => `app.${domain}`),
      'kawn.com',
      'www.kawn.com',
      'kawn.net',
      'www.kawn.net',
      'app.kawn.com',
      'app.kawn.net'
    ];
    
    if (mainDomains.includes(normalizedHostname)) {
      return null; // Main domain, not a subdomain
    }
    
    // Handle subdomains of the configured primary platform domain
    if (normalizedHostname.endsWith(`.${platformDomain}`)) {
      const subdomain = normalizedHostname.replace(`.${platformDomain}`, '');
      if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
        return subdomain;
      }
    }
    
    // Handle subdomains of the configured secondary domains/aliases
    for (const domain of secondaryDomainAliases) {
      if (normalizedHostname.endsWith(`.${domain}`)) {
        const subdomain = normalizedHostname.replace(`.${domain}`, '');
        if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
          return subdomain;
        }
      }
    }

    // Handle legacy subdomains of kawn.com (e.g., store.kawn.com)
    if (normalizedHostname.endsWith('.kawn.com')) {
      const subdomain = normalizedHostname.replace('.kawn.com', '');
      if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
        return subdomain;
      }
    }
    
    // Handle legacy subdomains of kawn.net (e.g., store.kawn.net)
    if (normalizedHostname.endsWith('.kawn.net')) {
      const subdomain = normalizedHostname.replace('.kawn.net', '');
      if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
        return subdomain;
      }
    }
    
    // Legacy: Handle old domain format if still in use
    const platformDomains = [
      platformDomain, `app.${platformDomain}`, 
      secondaryDomain, `app.${secondaryDomain}`,
      'saeaa.com', 'app.saeaa.com',
      "koun.com", "app.koun.com", "koun.net", "app.koun.net", 
      "kawn.com", "app.kawn.com", "kawn.net", "app.kawn.net", 
      "kounworld.com", "app.kounworld.com", "saeaa.net", "app.saeaa.net",
      "www.saeaa.com", "www.saeaa.net",
      "saa'ah.com", "app.saa'ah.com"
    ]; 
    for (const domain of platformDomains) {
      if (normalizedHostname.endsWith(domain)) {
        const subdomain = normalizedHostname.replace(`.${domain}`, '');
        if (subdomain !== normalizedHostname && subdomain !== 'www') {
          return subdomain;
        }
      }
    }
    
    return null;
  }
}
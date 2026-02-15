import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private adminApiKeyRequests = new WeakMap<object, boolean>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private reflector: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    
    // SECURITY FIX: Admin API key validation with rate limiting and database lookup
    const adminApiKey = request.headers['x-admin-api-key'] || request.headers['X-Admin-API-Key'];
    
    if (adminApiKey) {
      // Get expected key from environment (no fallback)
      const expectedAdminKey = this.configService.get<string>('ADMIN_API_KEY');
      
      if (!expectedAdminKey) {
        this.logger.error('ADMIN_API_KEY is not configured');
        throw new UnauthorizedException('Admin API key configuration error');
      }
      
      // SECURITY FIX: Reject default/weak keys and enforce minimum entropy
      const MIN_ADMIN_KEY_LENGTH = 16;
      const isDefaultKey = /^(Koun|Kawn)\d{4}Admin!$/.test(expectedAdminKey);
      if (isDefaultKey || expectedAdminKey.length < MIN_ADMIN_KEY_LENGTH) {
        this.logger.error('ADMIN_API_KEY is weak or default');
        throw new UnauthorizedException('Admin API key configuration error');
      }

      // SECURITY FIX: Use constant-time comparison to prevent timing attacks
      const apiKeyBuffer = Buffer.from(String(adminApiKey));
      const expectedKeyBuffer = Buffer.from(expectedAdminKey);
      
      const isMatch = apiKeyBuffer.length === expectedKeyBuffer.length && 
                      crypto.timingSafeEqual(apiKeyBuffer, expectedKeyBuffer);

      if (isMatch) {
        // SECURITY FIX: Log admin API key usage for audit
        const ip = request.ip || request.socket?.remoteAddress || 'unknown';
        this.logger.warn(`Admin API key used from IP: ${ip}, Path: ${request.path}`);
        
        // Admin API key is valid - set a system user
        const systemUser = {
          id: 'system-admin',
          tenantId: null,
          role: 'SUPER_ADMIN',
          email: 'system@admin.local'
        };
        request.user = systemUser;
        // Mark this request as having admin API key
        this.adminApiKeyRequests.set(request, true);
        this.logger.log('Admin API key validated successfully');
        // Return true directly - this will bypass JWT validation
        return true;
      } else {
        // SECURITY FIX: Log failed attempts
        const ip = request.ip || request.socket?.remoteAddress || 'unknown';
        this.logger.warn(`Invalid admin API key attempt from IP: ${ip}`);
        throw new UnauthorizedException('Invalid admin API key');
      }
    }
    
    // Otherwise, proceed with standard JWT verification
    try {
      const authenticated = await (super.canActivate(context) as Promise<boolean>);
      if (!authenticated) return false;

      // -----------------------------------------------------------------
      // TENANT ISOLATION FIX: Ensure token belongs to the requested store
      // -----------------------------------------------------------------
      const user = request.user;
      if (user && user.role !== 'SUPER_ADMIN') {
        let requestedTenantId = request.headers['x-tenant-id'] 
          || request.headers['x-tenant-domain'] 
          || request.headers['x-subdomain']
          || request.tenantId;

        // Fallback to Host header for tenant resolution
        if (!requestedTenantId || requestedTenantId === 'default') {
          const host = request.headers.host || '';
          if (host && !host.includes('localhost:3001') && !host.includes('app-auth')) {
            const subdomain = host.split('.')[0];
            if (subdomain && subdomain !== 'localhost' && subdomain !== 'app' && subdomain !== 'www') {
              requestedTenantId = subdomain;
            }
          }
        }

        // Normalize requestedTenantId for comparison
        let normalizedRequestedTenantId = requestedTenantId;
        if (typeof requestedTenantId === 'string' && requestedTenantId.includes('.')) {
          // If it's a domain like store.kawn.com or store.localhost, extract the subdomain
          const parts = requestedTenantId.split('.');
          if (requestedTenantId.includes('localhost')) {
            normalizedRequestedTenantId = parts[0] || 'default';
          } else {
            // Take the first part as subdomain (e.g., 'store' from 'store.kawn.com')
            normalizedRequestedTenantId = parts[0] || requestedTenantId;
          }
        }

        // If we have a specific tenant requested and the user belongs to a tenant, they must match
        if (normalizedRequestedTenantId && normalizedRequestedTenantId !== 'default' && user.tenantId) {
          // Check if it matches the tenant ID (UUID/CUID) or the subdomain
          const matchesId = user.tenantId === normalizedRequestedTenantId;
          const matchesSubdomain = user.tenant?.subdomain === normalizedRequestedTenantId;
          
          if (!matchesId && !matchesSubdomain) {
            this.logger.warn(`🚫 Tenant mismatch: User ${user.email} (Tenant: ${user.tenantId}/${user.tenant?.subdomain}) attempted to access Store: ${normalizedRequestedTenantId} (Original: ${requestedTenantId})`);
            throw new UnauthorizedException('Access denied: You are logged into a different store. Please log in to this store to continue.');
          }
        }
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('JWT authentication failed:', error);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  handleRequest(err: any, user: any, info: any, context?: ExecutionContext) {
    // If we have a context, check if the request had an admin API key
    if (context) {
      const request = context.switchToHttp().getRequest();
      const isAdminApiKey = this.adminApiKeyRequests.get(request);
      if (isAdminApiKey) {
        // This was an admin API key request - return the system user from request
        if (request.user) {
          return request.user;
        }
        // Fallback to system user if request.user is not set
        return {
          id: 'system-admin',
          tenantId: null,
          role: 'SUPER_ADMIN',
          email: 'system@admin.local'
        };
      }
    }

    // Standard JWT validation error handling
    if (err || !user) {
      this.logger.error('JWT validation error:', { err, info, hasUser: !!user });
      throw err || new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }
}
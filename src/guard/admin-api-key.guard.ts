import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiKeyGuard.name);
  private cachedApiKey: string | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private adminApiKeyAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-admin-api-key'] || request.headers['X-Admin-API-Key'];
    
    if (!apiKey) {
      throw new UnauthorizedException('Admin API key is required');
    }

    // Check if we're in development mode with no key configured (skip rate limiting in this case)
    const validApiKeyResult = await this.getValidApiKey();
    const isDevModeNoKey = validApiKeyResult === null;
    const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    
    // If dev mode with no key, accept any key immediately
    if (isDevModeNoKey) {
      // Development: no key configured → accept any non-empty key
      this.logger.warn(`⚠️ Dev mode: accepting admin key (no ADMIN_API_KEY set). Set ADMIN_API_KEY in .env for production.`);
      return true;
    }
    
    // SECURITY FIX: Rate limiting for admin API key attempts
    // Only apply rate limiting when a key is configured
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    let attempts = this.adminApiKeyAttempts.get(ip) || { count: 0, resetAt: Date.now() + 900000 }; // 15 minutes
    
    if (Date.now() > attempts.resetAt) {
      attempts.count = 0;
      attempts.resetAt = Date.now() + 900000;
    }
    
    // In development mode, reduce rate limit or allow bypass with special header
    const bypassRateLimit = isDevelopment && request.headers['x-dev-bypass-rate-limit'] === 'true';
    
    if (attempts.count >= 5 && !bypassRateLimit) {
      this.logger.warn(`Too many admin API key attempts from IP: ${ip} (${attempts.count} attempts, reset in ${Math.round((attempts.resetAt - Date.now()) / 1000 / 60)} minutes)`);
      // In development, provide helpful message
      if (isDevelopment) {
        this.logger.warn(`💡 Dev tip: Restart the server to clear rate limit, or set ADMIN_API_KEY in .env to match your key`);
      }
      throw new UnauthorizedException('Too many admin API key attempts. Please try again later.');
    }
    
    if (!bypassRateLimit) {
      attempts.count++;
      this.adminApiKeyAttempts.set(ip, attempts);
    }

    const validApiKey = validApiKeyResult;
    if (apiKey && validApiKey && apiKey.length === validApiKey.length) {
      const a = Buffer.from(apiKey);
      const b = Buffer.from(validApiKey);
      
      if (timingSafeEqual(a, b)) {
        this.logger.warn(`Admin API key used from IP: ${ip}, Path: ${request.path}`);
        attempts.count = 0;
        this.adminApiKeyAttempts.set(ip, attempts);
        return true;
      }
    } else {
      this.logger.error(`Admin API Key mismatch. Received length: ${apiKey?.length}, Expected length: ${validApiKey?.length}`);
      if (apiKey && validApiKey) {
           this.logger.error(`Received (start): ${apiKey.substring(0, 4)}...`);
           this.logger.error(`Expected (start): ${validApiKey.substring(0, 4)}...`);
      }
    }
    
    throw new UnauthorizedException('Invalid admin API key');
  }

  /** Returns the valid API key, or null in dev when no key is set (caller then accepts any key). */
  private async getValidApiKey(): Promise<string | null> {
    const now = Date.now();
    
    if (this.cachedApiKey && now < this.cacheExpiry) {
      return this.cachedApiKey;
    }

    try {
      const systemTenant = await this.prisma.tenant.findUnique({
        where: { id: 'system' },
        select: { settings: true },
      });

      if (systemTenant?.settings && typeof systemTenant.settings === 'object') {
        const settings = systemTenant.settings as any;
        if (settings.adminApiKey && typeof settings.adminApiKey === 'string') {
          this.cachedApiKey = settings.adminApiKey;
          this.cacheExpiry = now + this.CACHE_TTL;
          this.logger.debug('Admin API key loaded from database');
          return this.cachedApiKey!;
        }
      }

      const envKey = process.env.ADMIN_API_KEY;
      if (envKey) {
        this.cachedApiKey = envKey;
        this.cacheExpiry = now + this.CACHE_TTL;
        this.logger.debug('Admin API key loaded from environment variable');
        return envKey;
      }

      // Development or unset NODE_ENV: no key configured → accept any non-empty key
      const env = process.env.NODE_ENV || '';
      if (env === 'development' || env === '') {
        return null;
      }

      this.logger.error('❌ ADMIN_API_KEY is not configured. Set it in .env or configure in system tenant settings.');
      throw new UnauthorizedException('ADMIN_API_KEY is not configured');
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('Failed to get admin API key:', error);
      throw new UnauthorizedException('Admin API key configuration error');
    }
  }
}

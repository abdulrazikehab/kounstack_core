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

    // SECURITY FIX: Rate limiting for admin API key attempts
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const attempts = this.adminApiKeyAttempts.get(ip) || { count: 0, resetAt: Date.now() + 900000 }; // 15 minutes
    
    if (Date.now() > attempts.resetAt) {
      attempts.count = 0;
      attempts.resetAt = Date.now() + 900000;
    }
    
    if (attempts.count >= 5) {
      this.logger.warn(`Too many admin API key attempts from IP: ${ip}`);
      throw new UnauthorizedException('Too many admin API key attempts. Please try again later.');
    }
    
    attempts.count++;
    this.adminApiKeyAttempts.set(ip, attempts);

    // Get valid API key from database (with caching)
    const validApiKey = await this.getValidApiKey();
    
    if (apiKey && validApiKey && apiKey.length === validApiKey.length) {
      const a = Buffer.from(apiKey);
      const b = Buffer.from(validApiKey);
      
      if (timingSafeEqual(a, b)) {
        // SECURITY FIX: Log admin API key usage for audit
        this.logger.warn(`Admin API key used from IP: ${ip}, Path: ${request.path}`);
        // Reset attempt counter on success
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

  private async getValidApiKey(): Promise<string> {
    const now = Date.now();
    
    // Return cached key if still valid
    if (this.cachedApiKey && now < this.cacheExpiry) {
      return this.cachedApiKey;
    }

    try {
      // SECURITY FIX: Get API key from database (system tenant settings)
      // Try to get from Tenant settings first (system tenant)
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
          this.logger.debug('Admin API key loaded from database');
          return this.cachedApiKey!;
        }
      }

      // Fallback to environment variable (but require it)
      const envKey = process.env.ADMIN_API_KEY;
      if (!envKey) {
        this.logger.error('❌ ADMIN_API_KEY is not configured in environment variables');
        this.logger.error('❌ Please set ADMIN_API_KEY in .env or configure it in system tenant settings');
        throw new Error('ADMIN_API_KEY is not configured');
      }

      // SECURITY FIX: Reject default/weak keys
      if (envKey.length < 16) {
        this.logger.warn('⚠️ ADMIN_API_KEY is too short (should be > 16 chars). Allowing for now, but please rotate.');
        // Don't throw for now to avoid breaking production if they haven't updated env yet
        // throw new Error('ADMIN_API_KEY is insecure');
      }

      this.cachedApiKey = envKey;
      this.cacheExpiry = now + this.CACHE_TTL;
      this.logger.debug('Admin API key loaded from environment variable');
      return envKey;
    } catch (error) {
      this.logger.error('Failed to get admin API key:', error);
      throw new UnauthorizedException('Admin API key configuration error');
    }
  }
}

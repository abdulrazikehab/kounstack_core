import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

    // Rate limiting for admin API key attempts
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

    // Get valid API key
    const validApiKey = await this.getValidApiKey();
    
    if (apiKey && validApiKey && apiKey.length === validApiKey.length) {
      const a = Buffer.from(apiKey);
      const b = Buffer.from(validApiKey);
      
      if (timingSafeEqual(a, b)) {
        this.logger.debug(`Admin API key validated from IP: ${ip}, Path: ${request.path}`);
        // Reset attempt counter on success
        attempts.count = 0;
        this.adminApiKeyAttempts.set(ip, attempts);
        return true;
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
      // Try to get from system tenant settings first (shared DB with core)
      const systemTenant = await this.prisma.tenant.findUnique({
        where: { id: 'system' },
        select: { settings: true },
      });

      if (systemTenant?.settings && typeof systemTenant.settings === 'object') {
        const settings = systemTenant.settings as any;
        if (settings.adminApiKey && typeof settings.adminApiKey === 'string') {
          this.cachedApiKey = settings.adminApiKey;
          this.cacheExpiry = now + this.CACHE_TTL;
          return this.cachedApiKey!;
        }
      }

      // Fallback to environment variable
      const envKey = process.env.ADMIN_API_KEY;
      if (!envKey) {
        this.logger.error('ADMIN_API_KEY is not configured');
        throw new Error('ADMIN_API_KEY is not configured');
      }

      this.cachedApiKey = envKey;
      this.cacheExpiry = now + this.CACHE_TTL;
      return envKey;
    } catch (error) {
      this.logger.error('Failed to get admin API key:', error);
      throw new UnauthorizedException('Admin API key configuration error');
    }
  }
}

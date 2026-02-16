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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // -----------------------------------------------------------------
    // 1. ADMIN API KEY AUTHENTICATION
    // -----------------------------------------------------------------
    const adminApiKey = request.headers['x-admin-api-key'] || 
                       request.headers['X-Admin-API-Key'] ||
                       request.headers['x-api-key'] || 
                       request.headers['X-API-Key'] ||
                       request.headers['x-apikey'] ||
                       request.headers['X-ApiKey'];
    
    if (adminApiKey) {
      const expectedAdminKey = this.configService.get<string>('ADMIN_API_KEY');
      
      if (!expectedAdminKey) {
        this.logger.error('ADMIN_API_KEY is not configured');
        throw new UnauthorizedException('Admin API key configuration error');
      }
      
      const MIN_ADMIN_KEY_LENGTH = 16;
      if (expectedAdminKey.length < MIN_ADMIN_KEY_LENGTH) {
        this.logger.error('ADMIN_API_KEY is too weak');
        throw new UnauthorizedException('Admin API key configuration error');
      }

      const apiKeyBuffer = Buffer.from(String(adminApiKey));
      const expectedKeyBuffer = Buffer.from(expectedAdminKey);
      
      const isMatch = apiKeyBuffer.length === expectedKeyBuffer.length && 
                      crypto.timingSafeEqual(apiKeyBuffer, expectedKeyBuffer);

      if (isMatch) {
        const ip = request.ip || request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown';
        this.logger.log(`🔑 Admin API key validated successfully from IP: ${ip}`);
        
        const tenantId = request.headers['x-tenant-id'] || 
                        request.headers['X-Tenant-Id'] || 
                        null;

        request.user = {
          id: 'system-admin',
          tenantId: tenantId,
          role: 'SUPER_ADMIN',
          email: 'system@admin.local',
          isAdmin: true
        };
        request.tenantId = tenantId;
        this.adminApiKeyRequests.set(request, true);
        return true;
      } else {
        const ip = request.ip || request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown';
        this.logger.warn(`🚫 Invalid admin API key attempt from IP: ${ip} | Path: ${request.url}`);
        throw new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
      }
    }
    
    // -----------------------------------------------------------------
    // 2. JWT TOKEN AUTHENTICATION
    // -----------------------------------------------------------------
    try {
      const authenticated = await (super.canActivate(context) as Promise<boolean>);
      if (!authenticated) return false;

      const user = request.user;
      if (user && user.role !== 'SUPER_ADMIN') {
        let requestedTenantId = request.headers['x-tenant-id'] 
          || request.headers['x-tenant-domain'] 
          || request.headers['x-subdomain']
          || request.tenantId;

        if (!requestedTenantId || requestedTenantId === 'default') {
          const host = request.headers.host || '';
          if (host && !host.includes('localhost:3001') && !host.includes('app-auth')) {
            const parts = host.split('.');
            if (parts.length > 1) {
              const subdomain = parts[0];
              if (subdomain !== 'localhost' && subdomain !== 'app' && subdomain !== 'www') {
                requestedTenantId = subdomain;
              }
            }
          }
        }

        let normalizedRequestedTenantId = requestedTenantId;
        if (typeof requestedTenantId === 'string' && requestedTenantId.includes('.')) {
          const parts = requestedTenantId.split('.');
          if (requestedTenantId.includes('localhost')) {
            normalizedRequestedTenantId = parts[0] || 'default';
          } else if (parts.length >= 2) {
             const maybeSubdomain = parts[0];
             if (maybeSubdomain !== 'www' && maybeSubdomain !== 'app') {
               normalizedRequestedTenantId = maybeSubdomain;
             }
          }
        }

        if (normalizedRequestedTenantId && 
            normalizedRequestedTenantId !== 'default' && 
            normalizedRequestedTenantId !== 'localhost' &&
            user.tenantId) {
          
          const matchesId = user.tenantId === normalizedRequestedTenantId;
          const matchesSubdomain = user.tenant?.subdomain === normalizedRequestedTenantId;
          
          if (!matchesId && !matchesSubdomain) {
            this.logger.warn(`🚫 Tenant mismatch: User ${user.email} (Tenant: ${user.tenantId}) tried to access: ${normalizedRequestedTenantId}`);
            throw new UnauthorizedException('Access denied: You are logged into a different store. Please log in to this store to continue.');
          }
        }
      }

      return true;
    } catch (error: any) {
      if (error instanceof UnauthorizedException) throw error;
      
      this.logger.warn(`JWT validation failed: ${error.message}`);
      
      if (error.name === 'JsonWebTokenError') {
         if (error.message?.includes('invalid signature')) {
            throw new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
         }
         if (error.message?.includes('jwt expired')) {
            throw new UnauthorizedException('انتهت صلاحية جلسة المستخدم - يرجى تسجيل الدخول مرة أخرى');
         }
         throw new UnauthorizedException('رمز المصادقة غير صالح - يرجى تسجيل الدخول مرة أخرى');
      }
      
      throw new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
    }
  }

  handleRequest(err: any, user: any, info: any, context?: ExecutionContext) {
    if (context) {
      const request = context.switchToHttp().getRequest();
      if (this.adminApiKeyRequests.get(request)) {
        return request.user;
      }
    }

    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('انتهت صلاحية جلسة المستخدم - يرجى تسجيل الدخول مرة أخرى');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('رمز المصادقة غير صالح - يرجى تسجيل الدخول مرة أخرى');
      }
      throw err || new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
    }
    return user;
  }

}
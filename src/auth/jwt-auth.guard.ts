import { Injectable, ExecutionContext, UnauthorizedException, ForbiddenException, CanActivate, Optional, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ApiKeyService } from '../api-key/api-key.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly apiKeyService?: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    
    // Check for API key first (X-API-Key header) - only if ApiKeyService is available
    const apiKey = request.headers['x-api-key'] || request.headers['x-apikey'];
    if (apiKey && this.apiKeyService) {
      try {
        const apiKeyInfo = await this.apiKeyService.validateApiKey(apiKey);
        if (apiKeyInfo) {
          // Set user context for API key authentication
          request.user = {
            id: `api-key-${apiKeyInfo.apiKeyId}`,
            tenantId: apiKeyInfo.tenantId,
            role: 'API_CLIENT',
            email: null,
          };
          request.tenantId = apiKeyInfo.tenantId;
          return true;
        }
      } catch (error) {
        // If API key validation fails, continue to JWT check
      }
    }

    const token = this.extractTokenFromHeader(request);

    if (isPublic) {
      // For public routes, try to extract user info if token is present
      // This allows public endpoints to return user-specific data (like tenant content)
      if (token) {
        try {
          const secret = this.configService.get<string>('JWT_SECRET');
          if (secret) {
            const payload = this.jwtService.verify(token, { secret });
            // For customer tokens, the 'sub' field contains the customer.id
            // For regular users, 'sub' contains the user.id
            request.user = {
              id: payload.sub, // This is the customer.id for customers, user.id for regular users
              userId: payload.sub, // Alias for compatibility
              tenantId: payload.tenantId || null,
              role: payload.role || (payload.type === 'customer' ? 'CUSTOMER' : null),
              email: payload.email,
              firstName: payload.firstName,
              lastName: payload.lastName,
            };
            // IMPORTANT: Only set tenantId if it hasn't been set by TenantMiddleware already
            // This prevents public storefront requests from losing their domain context 
            // when a user is logged into a different store/dashboard.
            if (!request.tenantId) {
              request.tenantId = payload.tenantId || null;
            }
          }
        } catch (error) {
          // Ignore token errors for public routes
        }
      }
      return true;
    }
    
    // If no API key was provided and route is not public, require JWT token
    if (!token) {
      // Log detailed information about why token wasn't found
      const hasAuthHeader = !!request.headers.authorization;
      const hasCookies = !!request.cookies;
      const cookieNames = request.cookies ? Object.keys(request.cookies) : [];
      const hasAccessTokenCookie = !!request?.cookies?.accessToken;
      
      this.logger.warn(
        `No authentication token found for ${request.method} ${request.url} | ` +
        `hasAuthHeader: ${hasAuthHeader}, hasCookies: ${hasCookies}, ` +
        `cookieNames: [${cookieNames.join(', ')}], hasAccessTokenCookie: ${hasAccessTokenCookie} | ` +
        `host: ${request.headers.host}, origin: ${request.headers.origin || 'none'}`
      );
      
      throw new UnauthorizedException('No authentication token or API key provided');
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        this.logger.error('JWT_SECRET is not configured in core service');
        throw new UnauthorizedException('JWT_SECRET is not configured');
      }

      // SECURITY FIX: Removed token logging to prevent exposing JWT characteristics
      
      const payload = this.jwtService.verify(token, { secret });

      // Determine effective tenantId with STRICT security checks:
      const tenantIdFromToken = payload.tenantId || null;
      const requestTenantId = request.tenantId || null;
      let effectiveTenantId = null;

      // Check if this is a tenant setup endpoint - allow bypassing tenant mismatch check
      // Users should be able to create a new tenant even if logged into a different store
      const isTenantSetupEndpoint = request.url?.includes('/tenants/setup') || 
                                    request.path?.includes('/tenants/setup');
      
      if (isTenantSetupEndpoint) {
        this.logger.debug(
          `✅ Tenant setup endpoint detected - allowing tenant mismatch for user ${payload.email} ` +
          `(Token Tenant: ${tenantIdFromToken || 'null'}, Request Tenant: ${requestTenantId || 'null'})`
        );
      }

      if (tenantIdFromToken) {
        // Method 1: Token has a specific tenant claim (Strongest Proof)
        // Ensure the token's tenant matches the requested store's tenant
        effectiveTenantId = tenantIdFromToken;
        
        if (requestTenantId && 
            requestTenantId !== 'default' && 
            requestTenantId !== 'system' && 
            requestTenantId !== tenantIdFromToken && 
            payload.role !== 'SUPER_ADMIN' &&
            !isTenantSetupEndpoint) { // Allow tenant setup to bypass this check
          
          this.logger.warn(
            `🚫 Unauthorized cross-tenant access attempt. ` +
            `User ${payload.email} (Tenant: ${tenantIdFromToken}) tried to access Store: ${requestTenantId}`
          );
          
          // CRITICAL: Block unauthorized cross-tenant requests to prevent IDOR/Data Leakage
          throw new UnauthorizedException('Access denied: You are logged into a different store. Please log in to this store to continue.');
        }
      } else {
        // Method 2: Token has NO tenant claim (e.g. Platform User, Global Admin, or initial setup)
        if (payload.role === 'SUPER_ADMIN') {
          // Admins can assume identity of the requested tenant
          effectiveTenantId = requestTenantId;
        } else {
          // Regular users without a tenant claim can use the request tenantId if provided
          // This allows users who logged in before market setup to access their store
          // after setting it up (the X-Tenant-Id header will have the correct tenantId)
          effectiveTenantId = requestTenantId; 
        }
      }
      
      // Log payload info (without sensitive data) for debugging
      this.logger.debug(
        `JWT payload verified: userId=${payload.sub}, tokenTenantId=${tenantIdFromToken || 'null'}, ` +
        `effectiveTenantId=${effectiveTenantId || 'null'}, role=${payload.role}`
      );
      
      // Allow users without tenantId (for tenant setup flow)
      // The tenantId will be null for newly registered users who haven't set up their tenant yet
      // For customer tokens, payload.sub contains customer.id (unique per customer)
      // For regular users, payload.sub contains user.id
      request.user = {
        id: payload.sub, // This is customer.id for customers, user.id for regular users
        userId: payload.sub, // Alias for compatibility
        tenantId: effectiveTenantId,
        role: payload.role || (payload.type === 'customer' ? 'CUSTOMER' : null),
        type: payload.type, // Include type field for customer tokens
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
      };
      
      // IMPORTANT: Enforce the effective tenant ID on the request object as well
      // This ensures controllers rely on the verified identity, not the raw header
      request.tenantId = effectiveTenantId;
      
      return true;
    } catch (error: any) {
      // Log the error for debugging with more context
      const errorName = error?.name || 'Unknown';
      const errorMessage = error?.message || 'No message';
      const hasToken = !!token;
      const tokenLength = token?.length || 0;
      const tokenPreview = token ? `${token.substring(0, 20)}...` : 'none';
      const hasAuthHeader = !!request.headers.authorization;
      const hasCookie = !!request.cookies?.accessToken;
      
      this.logger.error(
        `JWT verification failed: ${errorName} - ${errorMessage} | ` +
        `hasToken: ${hasToken}, tokenLength: ${tokenLength}, tokenPreview: ${tokenPreview} | ` +
        `hasAuthHeader: ${hasAuthHeader}, hasCookie: ${hasCookie} | ` +
        `endpoint: ${request.url}, method: ${request.method} | ` +
        `host: ${request.headers.host}, origin: ${request.headers.origin || 'none'}`
      );
      
      // Handle JWT verification errors with better messages
      if (error?.name === 'JsonWebTokenError') {
        if (error.message?.includes('invalid signature')) {
          this.logger.error(
            '🚨 CRITICAL: JWT signature verification failed - JWT_SECRET mismatch detected! ' +
            'The JWT_SECRET used to sign tokens in app-auth does NOT match the JWT_SECRET ' +
            'used to verify tokens in app-core. This is a configuration error. ' +
            'Ensure JWT_SECRET environment variable is identical in both services.'
          );
          throw new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
        }
        if (error.message?.includes('jwt expired')) {
          this.logger.debug('JWT token has expired');
          throw new UnauthorizedException('انتهت صلاحية جلسة المستخدم - يرجى تسجيل الدخول مرة أخرى');
        }
        if (error.message?.includes('jwt malformed')) {
          this.logger.warn('JWT token is malformed - token format is invalid');
          throw new UnauthorizedException('رمز المصادقة غير صالح - يرجى تسجيل الدخول مرة أخرى');
        }
        if (error.message?.includes('jwt must be provided')) {
          this.logger.warn('JWT token was not provided in request');
          throw new UnauthorizedException('رمز المصادقة مطلوب - يرجى تسجيل الدخول');
        }
        this.logger.error(`Unhandled JsonWebTokenError: ${errorMessage}`);
        throw new UnauthorizedException(`فشل المصادقة: ${error.message || 'رمز غير صالح'}`);
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // For other errors, wrap in UnauthorizedException
      this.logger.error(
        `Unexpected authentication error: ${errorName} - ${errorMessage} | ` +
        `Stack: ${error?.stack?.substring(0, 300)}...`
      );
      throw new UnauthorizedException('فشل المصادقة - يرجى تسجيل الدخول مرة أخرى');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    // Try Authorization header first (client explicit intent > implicit cookie)
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        this.logger.debug(`Token extracted from Authorization header (length: ${token.length})`);
        return token;
      } else if (type && !token) {
        this.logger.warn(`Authorization header present but token is missing. Type: ${type}`);
      } else if (!type) {
        this.logger.warn(`Authorization header present but format is invalid: ${authHeader.substring(0, 20)}...`);
      }
    }
    
    // Fallback to cookie - check multiple possible cookie names
    const cookieToken = request?.cookies?.accessToken || 
                       request?.cookies?.token || 
                       request?.cookies?.authToken;
    
    if (cookieToken) {
      this.logger.debug(`Token extracted from cookie (length: ${cookieToken.length})`);
      return cookieToken;
    }
    
    // Log when no token is found with more context
    if (!authHeader && !cookieToken) {
      const cookieNames = request?.cookies ? Object.keys(request.cookies) : [];
      this.logger.debug(
        `No token found in Authorization header or cookies for ${request.url} | ` +
        `Available cookies: [${cookieNames.join(', ')}]`
      );
    }
    
    return undefined;
  }
}
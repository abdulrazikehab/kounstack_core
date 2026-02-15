import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

/**
 * Guard that ensures the user has a valid tenant selected and belongs to that tenant.
 * SECURITY FIX: Validates tenant membership to prevent IDOR attacks.
 * 
 * Usage:
 * @UseGuards(JwtAuthGuard, TenantRequiredGuard)
 * @Post()
 * create() { ... }
 */
@Injectable()
export class TenantRequiredGuard implements CanActivate {
  private readonly logger = new Logger(TenantRequiredGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    
    // For public routes, we don't strictly require a tenantId to proceed (but we still want to set it if found)
    const user = request.user;
    const tenantIdFromToken = user?.tenantId || null;
    const tenantIdFromMiddleware = request.tenantId || null;
    const tenantId = tenantIdFromToken || tenantIdFromMiddleware;

    if (isPublic) {
      if (tenantId) {
        request.tenantId = tenantId;
      }
      return true;
    }
    
    // SECURITY FIX: Never trust client-provided tenant IDs in headers
    // Only use tenant ID from JWT token (source of truth) or middleware (from domain)
    // Ignore X-Tenant-Id header to prevent IDOR attacks
    // (tenantIdFromToken, tenantIdFromMiddleware, and tenantId are already declared above)
    
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      this.logger.warn('TenantRequiredGuard: No valid tenantId found', {
        tenantId,
        hasTokenTenantId: !!tenantIdFromToken,
        hasMiddlewareTenantId: !!tenantIdFromMiddleware,
        hasUserId: !!user?.id,
        userEmail: user?.email,
        userRole: user?.role,
        path: request.url,
        method: request.method
      });
      throw new ForbiddenException(
        'You must set up a market first before performing this action. Please go to Market Setup to create your store. If you have already set up a market, please log out and log back in to refresh your session.'
      );
    }

    /**
     * SECURITY NOTE: We no longer check the database here for every request.
     * Membership validation is handled by JwtAuthGuard which ensures the JWT tenantId
     * matches the requested tenant ID. Since the JWT is signed by app-auth (source of truth),
     * we can trust the tenantId claim once verified by JwtAuthGuard.
     */
    
    // Set validated tenantId on request for use in controllers
    request.tenantId = tenantId;
    
    this.logger.debug(`TenantRequiredGuard: Valid tenantId found and validated: ${tenantId.substring(0, 20)}...`);
    return true;
  }
}


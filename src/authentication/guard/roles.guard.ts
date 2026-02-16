
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    // If no roles are required, allow access
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    
    // If no user, default denying (JwtAuthGuard should catch this, but safe fallback)
    if (!user) {
        throw new ForbiddenException('Access denied: User not authenticated');
    }

    // Check if user has one of the required roles
    // We assume user.role is a string (e.g. 'SUPER_ADMIN', 'SHOP_OWNER', 'STAFF')
    // Adjust logic if user.role is an array or if multiple roles are supported per user
    const hasRole = requiredRoles.includes(user.role);
    
    if (!hasRole) {
        throw new ForbiddenException(`Access denied: Requires one of the following roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}

import { Injectable, CanActivate, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Skip maintenance check for admin routes or specific headers
    const adminKey = request.headers['x-admin-api-key'] || request.headers['X-Admin-API-Key'];
    if (adminKey) {
      return true;
    }

    // Get platform config
    const config = await this.prisma.platformConfig.findUnique({
      where: { key: 'platform_details' },
    });

    if (config) {
      const value = config.value as any;
      if (value?.settings?.environmentMode === 'maintenance') {
        throw new ServiceUnavailableException({
          status: 'maintenance',
          message: 'System is currently under maintenance. Please try again later.',
          specialEvents: value?.settings?.specialEvents || {}
        });
      }
    }

    return true;
  }
}

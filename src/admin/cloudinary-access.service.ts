import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CloudinaryAccessService {
  private readonly logger = new Logger(CloudinaryAccessService.name);

  constructor(private prismaService: PrismaService) {}

  async getCloudinaryAccessUsers() {
    try {
      // Get all users with their Cloudinary access status
      const users = await this.prismaService.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          cloudinaryAccess: {
            select: {
              hasAccess: true,
              grantedAt: true,
              grantedBy: true,
            },
          },
        },
        orderBy: {
          email: 'asc',
        },
      });

      return {
        users: users.map((user: any) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          hasCloudinaryAccess: user.cloudinaryAccess?.hasAccess || false,
          grantedAt: user.cloudinaryAccess?.grantedAt,
          grantedBy: user.cloudinaryAccess?.grantedBy,
        })),
      };
    } catch (error: any) {
      this.logger.error('Failed to get Cloudinary access users:', {
        error: error.message,
        code: error.code,
        meta: error.meta,
      });
      
      // Check if it's a table doesn't exist error
      if (error.code === 'P2021' || error.message?.includes('does not exist') || error.message?.includes('Unknown model')) {
        throw new BadRequestException(
          'Cloudinary access table does not exist. Please run database migrations: npx prisma migrate dev'
        );
      }
      
      throw new BadRequestException(
        error.message || 'Failed to get Cloudinary access users'
      );
    }
  }

  async updateCloudinaryAccess(userIds: string[], hasAccess: boolean, grantedBy: string) {
    try {
      const results = [];

      for (const userId of userIds) {
        // Check if user exists
        const user = await this.prismaService.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          results.push({ userId, success: false, error: 'User not found' });
          continue;
        }

        // Update or create Cloudinary access record
        const access = await this.prismaService.userCloudinaryAccess.upsert({
          where: { userId },
          update: {
            hasAccess,
            grantedBy,
            grantedAt: new Date(),
          },
          create: {
            userId,
            hasAccess,
            grantedBy,
            grantedAt: new Date(),
          },
        });

        results.push({ userId, success: true, access });
      }

      return { results };
    } catch (error: any) {
      this.logger.error('Failed to update Cloudinary access:', {
        error: error.message,
        code: error.code,
        meta: error.meta,
        userIds,
      });
      
      // Check if it's a table doesn't exist error
      if (error.code === 'P2021' || error.message?.includes('does not exist') || error.message?.includes('Unknown model')) {
        throw new BadRequestException(
          'Cloudinary access table does not exist. Please run database migrations: npx prisma migrate dev'
        );
      }
      
      throw new BadRequestException(
        error.message || 'Failed to update Cloudinary access'
      );
    }
  }

  async getUserCloudinaryAccess(userId: string) {
    try {
      const access = await this.prismaService.userCloudinaryAccess.findUnique({
        where: { userId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      if (!access) {
        return {
          hasAccess: false,
          grantedAt: null,
          grantedBy: null,
          user: null,
        };
      }

      return {
        hasAccess: access.hasAccess,
        grantedAt: access.grantedAt,
        grantedBy: access.grantedBy,
        user: access.user,
      };
    } catch (error: any) {
      this.logger.error('Failed to get user Cloudinary access:', {
        error: error.message,
        code: error.code,
        meta: error.meta,
        userId,
      });
      
      // Check if it's a table doesn't exist error
      if (error.code === 'P2021' || error.message?.includes('does not exist') || error.message?.includes('Unknown model')) {
        throw new BadRequestException(
          'Cloudinary access table does not exist. Please run database migrations: npx prisma migrate dev'
        );
      }
      
      throw new BadRequestException(
        error.message || 'Failed to get user Cloudinary access'
      );
    }
  }
}


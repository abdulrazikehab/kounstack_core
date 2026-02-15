import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncUserDataDto, SyncLocationDataDto } from '../dto/sync.dto';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class MerchantSyncService {
  private readonly logger = new Logger(MerchantSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync user data from mobile app
   */
  async syncUserData(
    authenticatedUserId: string,
    authenticatedTenantId: string,
    dto: SyncUserDataDto,
  ) {
    try {
      // Validate that userId and tenantId match authenticated user
      if (dto.userId !== authenticatedUserId) {
        throw new UnauthorizedException('User ID in request does not match authenticated user');
      }

      if (dto.tenantId !== authenticatedTenantId) {
        throw new UnauthorizedException('Tenant ID in request does not match authenticated tenant');
      }

      // Validate timestamp is not in the future (with 5 minute tolerance for clock skew)
      const now = Date.now();
      const maxFutureTimestamp = now + 5 * 60 * 1000; // 5 minutes

      // Upsert user sync data
      const userSyncData = await this.prisma.userSyncData.upsert({
        where: {
          userId_tenantId: {
            userId: dto.userId,
            tenantId: dto.tenantId,
          },
        },
        update: {
          email: dto.email ?? undefined,
          username: dto.username ?? undefined,
          role: dto.role ?? undefined,
          tenantName: dto.tenantName ?? undefined,
          tenantSubdomain: dto.tenantSubdomain ?? undefined,
          avatar: dto.avatar ?? undefined,
          businessName: dto.businessName ?? undefined,
          businessNameAr: dto.businessNameAr ?? undefined,
          status: dto.status ?? undefined,
          defaultCurrency: dto.defaultCurrency ?? undefined,
          timezone: dto.timezone ?? undefined,
          isOwner: dto.isOwner ?? undefined,
          employeeId: dto.employeeId ?? undefined,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
        create: {
          userId: dto.userId,
          tenantId: dto.tenantId,
          email: dto.email,
          username: dto.username,
          role: dto.role,
          tenantName: dto.tenantName,
          tenantSubdomain: dto.tenantSubdomain,
          avatar: dto.avatar,
          businessName: dto.businessName,
          businessNameAr: dto.businessNameAr,
          status: dto.status,
          defaultCurrency: dto.defaultCurrency,
          timezone: dto.timezone,
          isOwner: dto.isOwner ?? false,
          employeeId: dto.employeeId,
          syncedAt: new Date(),
        },
      });

      this.logger.log(`User data synced successfully for user ${dto.userId} in tenant ${dto.tenantId}`);

      return {
        success: true,
        message: 'User data synced successfully',
      };
    } catch (error) {
      this.logger.error(`Error syncing user data: ${error.message}`, error.stack);
      
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to sync user data');
    }
  }

  /**
   * Sync a single location from mobile app
   */
  async syncLocation(
    authenticatedUserId: string,
    authenticatedTenantId: string,
    dto: SyncLocationDataDto,
  ) {
    try {
      // Validate coordinates
      if (dto.latitude < -90 || dto.latitude > 90) {
        throw new BadRequestException('Latitude must be between -90 and 90');
      }

      if (dto.longitude < -180 || dto.longitude > 180) {
        throw new BadRequestException('Longitude must be between -180 and 180');
      }

      // Validate timestamp is not in the future (with 5 minute tolerance for clock skew)
      const now = Date.now();
      const maxFutureTimestamp = now + 5 * 60 * 1000; // 5 minutes

      if (dto.timestamp > maxFutureTimestamp) {
        throw new BadRequestException('Timestamp cannot be in the future');
      }

      // Validate timestamp is not too old (more than 1 year)
      const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
      if (dto.timestamp < oneYearAgo) {
        throw new BadRequestException('Timestamp is too old (more than 1 year)');
      }

      // Convert numbers to Decimal for Prisma
      const locationData: Prisma.LocationSyncDataCreateInput = {
        userId: authenticatedUserId,
        tenantId: authenticatedTenantId,
        latitude: new Decimal(dto.latitude),
        longitude: new Decimal(dto.longitude),
        altitude: dto.altitude !== undefined ? new Decimal(dto.altitude) : undefined,
        accuracy: dto.accuracy !== undefined ? new Decimal(dto.accuracy) : undefined,
        altitudeAccuracy:
          dto.altitudeAccuracy !== undefined
            ? new Decimal(dto.altitudeAccuracy)
            : undefined,
        heading: dto.heading !== undefined ? new Decimal(dto.heading) : undefined,
        speed: dto.speed !== undefined ? new Decimal(dto.speed) : undefined,
        timestamp: BigInt(dto.timestamp),
        address: dto.address,
        city: dto.city,
        country: dto.country,
        postalCode: dto.postalCode,
        syncedAt: new Date(),
      };

      const location = await this.prisma.locationSyncData.create({
        data: locationData,
      });

      this.logger.log(
        `Location synced successfully for user ${authenticatedUserId} in tenant ${authenticatedTenantId}`,
      );

      return {
        success: true,
        message: 'Location synced successfully',
        locationId: location.id,
      };
    } catch (error) {
      this.logger.error(`Error syncing location: ${error.message}`, error.stack);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to sync location');
    }
  }

  /**
   * Sync multiple locations in batch
   */
  async syncLocationsBatch(
    authenticatedUserId: string,
    authenticatedTenantId: string,
    locations: SyncLocationDataDto[],
  ) {
    try {
      if (!locations || locations.length === 0) {
        throw new BadRequestException('Locations array cannot be empty');
      }

      if (locations.length > 100) {
        throw new BadRequestException('Maximum batch size is 100 locations');
      }

      const now = Date.now();
      const maxFutureTimestamp = now + 5 * 60 * 1000; // 5 minutes
      const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

      const validLocations: Prisma.LocationSyncDataCreateManyInput[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      // Validate each location
      for (let i = 0; i < locations.length; i++) {
        const location = locations[i];

        try {
          // Validate coordinates
          if (location.latitude < -90 || location.latitude > 90) {
            throw new Error('Latitude must be between -90 and 90');
          }

          if (location.longitude < -180 || location.longitude > 180) {
            throw new Error('Longitude must be between -180 and 180');
          }

          // Validate timestamp
          if (location.timestamp > maxFutureTimestamp) {
            throw new Error('Timestamp cannot be in the future');
          }

          if (location.timestamp < oneYearAgo) {
            throw new Error('Timestamp is too old (more than 1 year)');
          }

          // Add valid location to batch
          validLocations.push({
            userId: authenticatedUserId,
            tenantId: authenticatedTenantId,
            latitude: new Decimal(location.latitude),
            longitude: new Decimal(location.longitude),
            altitude: location.altitude !== undefined ? new Decimal(location.altitude) : undefined,
            accuracy: location.accuracy !== undefined ? new Decimal(location.accuracy) : undefined,
            altitudeAccuracy:
              location.altitudeAccuracy !== undefined
                ? new Decimal(location.altitudeAccuracy)
                : undefined,
            heading: location.heading !== undefined ? new Decimal(location.heading) : undefined,
            speed: location.speed !== undefined ? new Decimal(location.speed) : undefined,
            timestamp: BigInt(location.timestamp),
            address: location.address,
            city: location.city,
            country: location.country,
            postalCode: location.postalCode,
            syncedAt: new Date(),
          });
        } catch (error: any) {
          errors.push({
            index: i,
            error: error.message || 'Invalid location data',
          });
        }
      }

      // Use transaction to ensure atomicity
      let syncedCount = 0;
      if (validLocations.length > 0) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.locationSyncData.createMany({
              data: validLocations,
            });
          });
          syncedCount = validLocations.length;
        } catch (error) {
          this.logger.error(`Error in batch location sync transaction: ${error.message}`, error.stack);
          throw new InternalServerErrorException('Failed to sync locations batch');
        }
      }

      this.logger.log(
        `Batch location sync completed: ${syncedCount} synced, ${errors.length} failed for user ${authenticatedUserId}`,
      );

      const response: any = {
        success: true,
        message:
          errors.length === 0
            ? 'Locations synced successfully'
            : 'Some locations synced',
        count: locations.length,
        synced: syncedCount,
        failed: errors.length,
      };

      if (errors.length > 0) {
        response.errors = errors;
      }

      return response;
    } catch (error) {
      this.logger.error(`Error syncing locations batch: ${error.message}`, error.stack);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to sync locations batch');
    }
  }
}


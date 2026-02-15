import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  Headers,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { MerchantSyncService } from '../services/merchant-sync.service';
import { SyncUserDataDto, SyncLocationDataDto, SyncLocationsBatchDto } from '../dto/sync.dto';
import { AuthenticatedRequest } from '../../types/request.types';

@Controller('merchant/sync')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MerchantSyncController {
  private readonly logger = new Logger(MerchantSyncController.name);

  constructor(private readonly syncService: MerchantSyncService) {}

  /**
   * POST /api/merchant/sync/user
   * Sync user data from mobile app
   */
  @Post('user')
  async syncUser(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Body() dto: SyncUserDataDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.syncService.syncUserData(authenticatedUserId, authenticatedTenantId, dto);
    } catch (error: any) {
      this.logger.error(`Error in syncUser endpoint: ${error.message}`, error.stack);
      
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Failed to sync user data');
    }
  }

  /**
   * POST /api/merchant/sync/location
   * Sync a single location from mobile app
   */
  @Post('location')
  async syncLocation(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Body() dto: SyncLocationDataDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.syncService.syncLocation(authenticatedUserId, authenticatedTenantId, dto);
    } catch (error: any) {
      this.logger.error(`Error in syncLocation endpoint: ${error.message}`, error.stack);
      
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Failed to sync location');
    }
  }

  /**
   * POST /api/merchant/sync/locations
   * Sync multiple locations in batch from mobile app
   */
  @Post('locations')
  async syncLocations(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Body() dto: SyncLocationsBatchDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.syncService.syncLocationsBatch(
        authenticatedUserId,
        authenticatedTenantId,
        dto.locations,
      );
    } catch (error: any) {
      this.logger.error(`Error in syncLocations endpoint: ${error.message}`, error.stack);
      
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Failed to sync locations');
    }
  }
}


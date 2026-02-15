import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';
import { AuthenticatedRequest } from '../types/request.types';
import { KycSettingsService } from './kyc-settings.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class KycSettingsController {
  constructor(private readonly kycSettingsService: KycSettingsService) {}

  @Get('settings')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getSettings(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.user?.id;
    return this.kycSettingsService.getSettings(tenantId);
  }

  @Put('settings')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateSettings(
    @Request() req: AuthenticatedRequest,
    @Body() settings: {
      kycEnabled?: boolean;
      requireKycForOrders?: boolean;
      requireKycForLargePayments?: boolean;
      kycThreshold?: number;
      requireIdVerification?: boolean;
      requireAddressVerification?: boolean;
      autoApproveKyc?: boolean;
    }
  ) {
    const tenantId = req.user?.tenantId || req.user?.id;
    return this.kycSettingsService.updateSettings(tenantId, settings);
  }
}


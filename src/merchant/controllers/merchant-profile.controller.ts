import {
  Controller,
  Get,
  Patch,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { UpdateMerchantProfileDto, MerchantSettingsDto } from '../dto';

@Controller('merchant/profile')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MerchantProfileController {
  constructor(
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get()
  async getProfile(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    const merchant = await this.merchantService.getMerchant(context.merchantId);
    const wallet = await this.merchantService.getWalletBalance(context.merchantId);

    return {
      id: merchant.id,
      businessName: merchant.businessName,
      businessNameAr: merchant.businessNameAr,
      phone: merchant.phone,
      email: merchant.email,
      countryCode: merchant.countryCode,
      defaultCurrency: merchant.defaultCurrency,
      timezone: merchant.timezone,
      status: merchant.status,
      settings: merchant.settings,
      lowBalanceThreshold: Number(merchant.lowBalanceThreshold),
      walletBalance: wallet.balance,
      createdAt: merchant.createdAt,
    };
  }

  @Patch()
  async updateProfile(
    @Request() req: any,
    @Body() dto: UpdateMerchantProfileDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'settingsWrite');

    const merchant = await this.merchantService.updateProfile(context.merchantId, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.PROFILE_UPDATED,
      'Merchant',
      context.merchantId,
      { changes: dto },
    );

    return {
      id: merchant.id,
      businessName: merchant.businessName,
      businessNameAr: merchant.businessNameAr,
      phone: merchant.phone,
      email: merchant.email,
      timezone: merchant.timezone,
      lowBalanceThreshold: Number(merchant.lowBalanceThreshold),
    };
  }

  @Get('settings')
  async getSettings(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.merchantService.getSettings(context.merchantId);
  }

  @Patch('settings')
  async updateSettings(
    @Request() req: any,
    @Body() dto: MerchantSettingsDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'settingsWrite');

    const settings = await this.merchantService.updateSettings(context.merchantId, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.SETTINGS_UPDATED,
      'Merchant',
      context.merchantId,
      { changes: dto },
    );

    return settings;
  }
}


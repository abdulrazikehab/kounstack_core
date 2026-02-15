import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PromotionService } from '../services/promotion.service';
import { MerchantService } from '../services/merchant.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { PromotionListQuery } from '../dto';

@Controller('merchant/promotions')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class PromotionController {
  constructor(
    private readonly promotionService: PromotionService,
    private readonly merchantService: MerchantService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: PromotionListQuery,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.promotionService.findAll(context.tenantId, context.merchantId, query);
  }

  @Get(':id')
  async findOne(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.promotionService.findOne(context.tenantId, context.merchantId, id);
  }

  @Get(':id/progress')
  async getProgress(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.promotionService.getProgress(context.merchantId, id);
  }
}


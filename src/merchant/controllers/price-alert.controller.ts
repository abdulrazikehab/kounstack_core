import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PriceAlertService } from '../services/price-alert.service';
import { MerchantService } from '../services/merchant.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { CreatePriceAlertDto, PriceAlertListQuery } from '../dto';

@Controller('merchant/price-alerts')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class PriceAlertController {
  constructor(
    private readonly priceAlertService: PriceAlertService,
    private readonly merchantService: MerchantService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: PriceAlertListQuery,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.priceAlertService.findAll(context.merchantId, query);
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() dto: CreatePriceAlertDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.priceAlertService.create(context.merchantId, dto);
  }

  @Delete(':id')
  async delete(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.priceAlertService.delete(context.merchantId, id);
  }

  @Post(':id/toggle')
  async toggle(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.priceAlertService.toggle(context.merchantId, id);
  }
}


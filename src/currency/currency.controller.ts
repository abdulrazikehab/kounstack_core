import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, Logger, Headers } from '@nestjs/common';
import {
  CurrencyService,
  CreateCurrencyDto,
  UpdateCurrencyDto,
  UpdateCurrencySettingsDto,
} from './currency.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('currencies')
export class CurrencyController {
  private readonly logger = new Logger(CurrencyController.name);

  constructor(private readonly currencyService: CurrencyService) {}

  private resolveTenantId(req: AuthenticatedRequest, tenantIdHeader?: string): string {
    const tenantId =
      req.user?.tenantId ||
      req.tenantId ||
      tenantIdHeader ||
      (req.headers?.['x-tenant-id'] as string | undefined);

    if (!tenantId) {
      this.logger.warn('Tenant ID missing in request', {
        user: req.user,
        requestTenantId: req.tenantId,
        tenantIdHeader,
      });
      throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
    }

    return String(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body() data: CreateCurrencyDto,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.create(tenantId, data);
  }

  @Get()
  async findAll(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      return this.currencyService.findAll(tenantId);
    } catch (error: any) {
      this.logger.error('Error fetching currencies:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch currencies: ${error?.message || 'Unknown error'}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('initialize')
  async initialize(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      await this.currencyService.initializeDefaultCurrencies(tenantId);
      return { message: 'Currencies initialized successfully', tenantId };
    } catch (error: any) {
      this.logger.error('Error initializing currencies:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to initialize currencies: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get('settings')
  async getSettings(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      return this.currencyService.getSettings(tenantId);
    } catch (error: any) {
      this.logger.error('Error fetching currency settings:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch currency settings: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get('default')
  async getDefault(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      return this.currencyService.getDefaultCurrency(tenantId);
    } catch (error: any) {
      this.logger.error('Error fetching default currency:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch default currency: ${error?.message || 'Unknown error'}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Put('default/:code')
  async setDefault(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('code') code: string,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.setDefault(tenantId, code);
  }

  @UseGuards(JwtAuthGuard)
  @Put('settings')
  async updateSettings(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body() data: UpdateCurrencySettingsDto,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.updateSettings(tenantId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Put('rates')
  async updateRates(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body() rates: Record<string, number>,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.updateExchangeRates(tenantId, rates);
  }

  @Get(':code')
  async findOne(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('code') code: string,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.findOne(tenantId, code);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':code')
  async update(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('code') code: string,
    @Body() data: UpdateCurrencyDto,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.update(tenantId, code, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':code')
  async remove(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param('code') code: string,
  ) {
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    return this.currencyService.remove(tenantId, code);
  }
}


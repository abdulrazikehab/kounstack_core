import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, Logger } from '@nestjs/common';
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

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() data: CreateCurrencyDto) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.currencyService.create(tenantId, data);
  }

  @Get()
  async findAll(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || req.user?.id;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
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
  async initialize(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || req.user?.id;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
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
  async getSettings(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || req.user?.id;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
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
  async getDefault(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || req.user?.id;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
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
  async setDefault(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    const tenantId = req.user?.tenantId || req.user?.id;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.currencyService.setDefault(tenantId, code);
  }

  @UseGuards(JwtAuthGuard)
  @Put('settings')
  async updateSettings(@Request() req: AuthenticatedRequest, @Body() data: UpdateCurrencySettingsDto) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.currencyService.updateSettings(tenantId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Put('rates')
  async updateRates(@Request() req: AuthenticatedRequest, @Body() rates: Record<string, number>) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.currencyService.updateExchangeRates(tenantId, rates);
  }

  @Get(':code')
  async findOne(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    const tenantId = req.user?.tenantId || req.tenantId || req.user?.id;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.currencyService.findOne(tenantId, code);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':code')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() data: UpdateCurrencyDto,
  ) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.currencyService.update(tenantId, code, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':code')
  async remove(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.currencyService.remove(tenantId, code);
  }
}


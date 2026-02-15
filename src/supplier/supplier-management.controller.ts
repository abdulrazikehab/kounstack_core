import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, Logger } from '@nestjs/common';
import { SupplierService, CreateSupplierDto, UpdateSupplierDto } from './supplier.service';
import { SupplierStatisticsService } from './supplier-statistics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SupplierManagementController {
  private readonly logger = new Logger(SupplierManagementController.name);

  constructor(
    private readonly supplierService: SupplierService,
    private readonly statisticsService: SupplierStatisticsService,
  ) {}

  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() data: CreateSupplierDto) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.create(tenantId, data);
  }

  @Get()
  async findAll(@Request() req: AuthenticatedRequest) {
    try {
      // Check if user is authenticated
      if (!req.user) {
        this.logger.warn('User not authenticated in suppliers findAll');
        throw new BadRequestException('Authentication required. Please log in.');
      }
      
      // Get tenantId from user or request context
      const tenantId = req.user?.tenantId || req.tenantId;
      
      if (!tenantId || tenantId === 'default' || tenantId === 'system') {
        this.logger.warn('Tenant ID missing or invalid in request', { 
          userId: req.user?.id,
          userTenantId: req.user?.tenantId, 
          reqTenantId: req.tenantId 
        });
        throw new BadRequestException(
          'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
        );
      }
      
      return this.supplierService.findAll(tenantId);
    } catch (error: any) {
      this.logger.error('Error in findAll suppliers:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch suppliers: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get(':id')
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.findOne(tenantId, id);
  }

  @Put(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateSupplierDto,
  ) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.update(tenantId, id, data);
  }

  @Delete(':id')
  async remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.remove(tenantId, id);
  }

  @Post(':id/test-connection')
  async testConnection(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    const connected = await this.supplierService.testConnection(tenantId, id);
    return { connected, message: connected ? 'Connection successful' : 'Connection failed' };
  }

  @Get(':id/balance')
  async checkBalance(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.checkBalance(tenantId, id);
  }

  @Get(':id/products')
  async getProducts(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('merchantId') merchantId?: string
  ) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.getSupplierProducts(tenantId, id, merchantId);
  }

  @Get(':id/products/:productId')
  async getProductDetails(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('productId') productId: string
  ) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.supplierService.getSupplierProductDetails(tenantId, id, productId);
  }

  @Get(':id/statistics')
  async getStatistics(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.statisticsService.getSupplierStatistics(tenantId, id);
  }

  @Get('statistics/all')
  async getAllStatistics(@Request() req: AuthenticatedRequest) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.statisticsService.getAllSuppliersStatistics(tenantId);
  }
}


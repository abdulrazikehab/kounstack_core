import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { SupplierPricingService } from './supplier-pricing.service';
import { SupplierPurchaseService } from './supplier-purchase.service';

@UseGuards(JwtAuthGuard)
@Controller('supplier-api')
export class SupplierApiController {
  private readonly logger = new Logger(SupplierApiController.name);

  constructor(
    private readonly pricingService: SupplierPricingService,
    private readonly purchaseService: SupplierPurchaseService,
  ) {}

  /**
   * Get price from a specific supplier
   */
  @Get('price/:productId/:supplierId')
  async getSupplierPrice(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Param('supplierId') supplierId: string,
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
    
    return this.pricingService.fetchSupplierPrice(tenantId, productId, supplierId);
  }

  /**
   * Get prices from all suppliers for a product
   */
  @Get('prices/:productId')
  async getAllSupplierPrices(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
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
    
    return this.pricingService.fetchAllSupplierPrices(tenantId, productId);
  }

  /**
   * Select best supplier for a product
   */
  @Get('best/:productId')
  async getBestSupplier(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
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
    
    return this.pricingService.selectBestSupplier(tenantId, productId);
  }

  /**
   * Purchase from a specific supplier
   */
  @Post('purchase/:productId/:supplierId')
  async purchaseFromSupplier(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Param('supplierId') supplierId: string,
    @Body() body: { quantity?: number },
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
    
    return this.purchaseService.purchaseFromSupplier(
      tenantId,
      productId,
      supplierId,
      body.quantity || 1,
    );
  }

  /**
   * Auto-purchase from best supplier
   */
  @Post('auto-purchase/:productId')
  async autoPurchase(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Body() body: { quantity?: number },
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
    
    return this.purchaseService.autoPurchaseBestSupplier(
      tenantId,
      productId,
      body.quantity || 1,
    );
  }

  /**
   * Cancel purchase and request refund
   */
  @Post('cancel/:purchaseId')
  async cancelPurchase(
    @Request() req: AuthenticatedRequest,
    @Param('purchaseId') purchaseId: string,
    @Body() body: { reason: string },
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
    
    return this.purchaseService.cancelPurchaseAndRefund(
      tenantId,
      purchaseId,
      body.reason,
    );
  }

  /**
   * Monitor active purchases (check prices and stop if unfavorable)
   */
  @Post('monitor')
  async monitorPurchases(@Request() req: AuthenticatedRequest) {
    if (!req.user) {
      throw new BadRequestException('Authentication required. Please log in.');
    }
    
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException(
        'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
      );
    }
    
    return this.purchaseService.monitorActivePurchases(tenantId);
  }

  /**
   * Check if should stop purchasing from supplier
   */
  @Get('should-stop/:productId/:supplierId')
  async shouldStopPurchase(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Param('supplierId') supplierId: string,
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
    
    return this.pricingService.shouldStopPurchase(tenantId, productId, supplierId);
  }

  /**
   * Get all purchases for the tenant
   */
  @Get('purchases')
  async getPurchases(@Request() req: AuthenticatedRequest) {
    try {
      if (!req.user) {
        this.logger.warn('User not authenticated in getPurchases');
        throw new BadRequestException('Authentication required. Please log in.');
      }

      // Get tenantId from multiple sources (priority: user.tenantId > req.tenantId)
      const tenantId = req.user?.tenantId || req.tenantId;
      
      // Validate tenantId - reject 'default' and 'system' as invalid
      if (!tenantId || tenantId === 'default' || tenantId === 'system') {
        this.logger.warn('Tenant ID missing or invalid in request', {
          userId: req.user?.id,
          userTenantId: req.user?.tenantId,
          reqTenantId: req.tenantId,
        });
        throw new BadRequestException(
          'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
        );
      }

      this.logger.debug(`Fetching purchases for tenant: ${tenantId}`);
      return await this.purchaseService.getPurchases(tenantId);
    } catch (error: any) {
      this.logger.error('Error fetching purchases:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to fetch purchases: ${error?.message || 'Unknown error'}`
      );
    }
  }
}


import { Controller, Post, Get, Request, UseGuards, Body } from '@nestjs/common';
import { SupplierProductsService } from './supplier-products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('supplier/products')
@UseGuards(JwtAuthGuard)
export class SupplierProductsController {
  constructor(private readonly service: SupplierProductsService) {}

  @Post('sync')
  async sync() {
    return this.service.syncSupplierProducts();
  }

  @Post('auto-fill')
  async autoFill(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.service.autoFillProductCodes(tenantId);
  }

  @Post('auto-fill/accept')
  async acceptAutoFill(@Request() req: AuthenticatedRequest, @Body() body: { productIds: string[] }) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.service.acceptAutoFillMatches(tenantId, body.productIds);
  }

  @Post('clear-product-codes')
  async clearProductCodes(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.service.clearAllProductCodes(tenantId);
  }

  @Get()
  async findAll() {
    return this.service.findAll();
  }
}

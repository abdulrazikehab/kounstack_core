import { Controller, Post, Get, Param, UseGuards, Request } from '@nestjs/common';
import { SupplierInventoryService } from './supplier-inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@UseGuards(JwtAuthGuard)
@Controller('supplier')
export class SupplierController {
  constructor(private readonly supplierInventoryService: SupplierInventoryService) {}

  @Post('sync/:productId')
  async syncProductInventory(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.supplierInventoryService.syncProductInventory(tenantId, productId);
  }

  @Post('sync-all')
  async syncAllInventory(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.supplierInventoryService.syncAllInventory(tenantId);
  }
}


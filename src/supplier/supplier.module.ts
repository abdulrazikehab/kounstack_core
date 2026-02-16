import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SupplierInventoryService } from './supplier-inventory.service';
import { SupplierService } from './supplier.service';
import { SupplierPricingService } from './supplier-pricing.service';
import { SupplierPurchaseService } from './supplier-purchase.service';
import { SupplierStatisticsService } from './supplier-statistics.service';
import { SupplierController } from './supplier.controller';
import { SupplierManagementController } from './supplier-management.controller';
import { SupplierApiController } from './supplier-api.controller';
import { SupplierProductsController } from './supplier-products.controller';
import { SupplierProductsService } from './supplier-products.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BitaqatyBusinessService } from './integrations/bitaqaty-business.service';
import { SupplierAdapterFactory } from './integrations/supplier-adapter.factory';
import { SupplierHubClient } from './integrations/supplier-hub.client';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, HttpModule, AuthModule],
  controllers: [SupplierController, SupplierManagementController, SupplierApiController, SupplierProductsController],
  providers: [
    SupplierInventoryService,
    SupplierService,
    SupplierPricingService,
    SupplierPurchaseService,
    SupplierStatisticsService,
    SupplierProductsService,
    BitaqatyBusinessService,
    SupplierHubClient,
    SupplierAdapterFactory,
  ],
  exports: [
    SupplierInventoryService,
    SupplierService,
    SupplierPricingService,
    SupplierPurchaseService,
    SupplierProductsService,
    BitaqatyBusinessService,
    SupplierHubClient,
    SupplierAdapterFactory,
  ],
})
export class SupplierModule {}


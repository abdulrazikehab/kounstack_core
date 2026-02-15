import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { DigitalCardsDeliveryService } from './digital-cards-delivery.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { SupplierModule } from '../supplier/supplier.module';
import { CartModule } from '../cart/cart.module';
import { CardsModule } from '../cards/cards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';

import { UserModule } from '../user/user.module';
import { MerchantModule } from '../merchant/merchant.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, SupplierModule, CartModule, CardsModule, NotificationsModule, HttpModule, InventoryModule, UserModule, MerchantModule],
  controllers: [OrderController],
  providers: [OrderService, DigitalCardsDeliveryService],
  exports: [OrderService, DigitalCardsDeliveryService],
})
export class OrderModule {}
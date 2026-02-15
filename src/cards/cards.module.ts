import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { CardProductService } from './card-product.service';
import { CardProductController } from './card-product.controller';
import { CardInventoryService } from './card-inventory.service';
import { CardInventoryController } from './card-inventory.controller';
import { CardOrderService } from './card-order.service';
import { CardOrderController } from './card-order.controller';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, UserModule, HttpModule, NotificationsModule],
  controllers: [
    CardProductController,
    CardInventoryController,
    CardOrderController,
    WalletController,
    FavoritesController,
  ],
  providers: [
    CardProductService,
    CardInventoryService,
    CardOrderService,
    WalletService,
    FavoritesService,
  ],
  exports: [
    CardProductService,
    CardInventoryService,
    CardOrderService,
    WalletService,
    FavoritesService,
  ],
})
export class CardsModule {}


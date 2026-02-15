import { Module } from '@nestjs/common';
import { CustomerInventoryController } from './customer-inventory.controller';
import { CustomerInventoryService } from './customer-inventory.service';

import { UserModule } from '../user/user.module';
import { CardsModule } from '../cards/cards.module';
import { OrderModule } from '../order/order.module';
import { MerchantModule } from '../merchant/merchant.module';

@Module({
  imports: [UserModule, CardsModule, OrderModule, MerchantModule],
  controllers: [CustomerInventoryController],
  providers: [CustomerInventoryService],
  exports: [CustomerInventoryService],
})
export class CustomerModule {}

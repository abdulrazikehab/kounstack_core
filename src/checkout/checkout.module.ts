import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { CartModule } from '../cart/cart.module';
import { OrderModule } from '../order/order.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FraudModule } from '../fraud/fraud.module';
import { AuthModule } from '../auth/auth.module';
import { GuestCheckoutModule } from '../guest-checkout/guest-checkout.module';
import { PurchaseLimitsModule } from '../purchase-limits/purchase-limits.module';

@Module({
  imports: [CartModule, OrderModule, PrismaModule, FraudModule, AuthModule, GuestCheckoutModule, PurchaseLimitsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
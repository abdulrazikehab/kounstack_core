// apps/app-core/src/cart/cart.module.ts
import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { TaxModule } from '../tax/tax.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [PrismaModule, AuthModule, RedisModule, TaxModule, ShippingModule, CouponModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
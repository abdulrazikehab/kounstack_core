import { Module } from '@nestjs/common';
import { GuestCheckoutService } from './guest-checkout.service';
import { GuestCheckoutController } from './guest-checkout.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [GuestCheckoutController],
  providers: [GuestCheckoutService, PrismaService],
  exports: [GuestCheckoutService],
})
export class GuestCheckoutModule {}

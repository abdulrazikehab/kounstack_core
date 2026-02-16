import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentOptionsService } from './payment-options.service';
import { PaymentOptionsController } from './payment-options.controller';
import { HyperPayService } from './hyperpay.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PaymentController, PaymentOptionsController],
  providers: [PaymentSettingsService, PaymentOptionsService, HyperPayService, PrismaService],
  exports: [PaymentSettingsService, PaymentOptionsService, HyperPayService],
})
export class PaymentModule {}
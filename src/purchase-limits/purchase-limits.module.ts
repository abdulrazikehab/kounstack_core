import { Module } from '@nestjs/common';
import { PurchaseLimitsController } from './purchase-limits.controller';
import { PurchaseLimitsService } from './purchase-limits.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseLimitsController],
  providers: [PurchaseLimitsService],
  exports: [PurchaseLimitsService],
})
export class PurchaseLimitsModule {}

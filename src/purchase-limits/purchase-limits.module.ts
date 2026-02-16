import { Module } from '@nestjs/common';
import { PurchaseLimitsController } from './purchase-limits.controller';
import { PurchaseLimitsService } from './purchase-limits.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PurchaseLimitsController],
  providers: [PurchaseLimitsService],
  exports: [PurchaseLimitsService],
})
export class PurchaseLimitsModule {}

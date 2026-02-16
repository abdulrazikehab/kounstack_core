import { Module } from '@nestjs/common';
import { UnitService } from './unit.service';
import { UnitController } from './unit.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrencyModule } from '../currency/currency.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, CurrencyModule, AuthModule],
  controllers: [UnitController],
  providers: [UnitService],
  exports: [UnitService],
})
export class UnitModule {}


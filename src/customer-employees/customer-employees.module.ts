import { Module } from '@nestjs/common';
import { CustomerEmployeesService } from './customer-employees.service';
import { CustomerEmployeesController } from './customer-employees.controller';
import { AuthModule } from '../authentication/auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
  ],
  controllers: [CustomerEmployeesController],
  providers: [CustomerEmployeesService],
  exports: [CustomerEmployeesService],
})
export class CustomerEmployeesModule {}


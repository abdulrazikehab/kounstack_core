import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CustomerRegistrationRequestController } from './customer-registration-request.controller';
import { CustomerRegistrationRequestService } from './customer-registration-request.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthModule } from '../auth/auth.module';
// Email service will be added later if needed

@Module({
  // Import Prisma for DB access and TenantModule so we can inject TenantService
  imports: [PrismaModule, forwardRef(() => TenantModule), HttpModule, AuthModule],
  controllers: [CustomerRegistrationRequestController],
  providers: [CustomerRegistrationRequestService],
  exports: [CustomerRegistrationRequestService],
})
export class CustomerRegistrationRequestModule {}


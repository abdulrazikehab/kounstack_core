import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TenantMiddleware } from './tenant.middleware';
import { TenantSyncService } from './tenant-sync.service';
import { AuthClientService } from './auth-client.service';
import { DomainService } from '../domain/domain.service'; // Add this
import { PrismaModule } from '../prisma/prisma.module';
import { DomainModule } from '../domain/domain.module';
import { AuthModule } from '../auth/auth.module'; // Add this
import { PageModule } from '../page/page.module';
import { TemplateModule } from '../template/template.module';
import { UserModule } from '../user/user.module';
import { MerchantModule } from '../merchant/merchant.module';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule,
    ConfigModule,
    DomainModule,
    AuthModule, // Add AuthModule // Add this to make DomainService available
    UserModule,
    MerchantModule,
    CurrencyModule,
    forwardRef(() => PageModule),
    forwardRef(() => TemplateModule),
  ],
  controllers: [TenantController],
  providers: [
    TenantService, 
    TenantMiddleware, 
    TenantSyncService,
    AuthClientService,
    DomainService, // Add DomainService here too
  ],
  exports: [TenantSyncService, TenantMiddleware, TenantService, DomainService, AuthClientService],
})
export class TenantModule {}
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';
import { PrismaService } from '../prisma/prisma.service';

import { PageModule } from '../page/page.module';
import { PaymentModule } from '../payment/payment.module';

import { TenantModule } from '../tenant/tenant.module';
import { AppBuilderModule } from '../app-builder/app-builder.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PageModule, PaymentModule, HttpModule, TenantModule, AppBuilderModule, AuthModule],
  controllers: [SiteConfigController],
  providers: [SiteConfigService, PrismaService],
  exports: [SiteConfigService],
})
export class SiteConfigModule {}

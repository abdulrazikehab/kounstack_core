// src/app.module.ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule as AuthenticationAuthModule } from './authentication/auth/auth.module';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { CustomerEmployeesModule } from './customer-employees/customer-employees.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';
import { SiteConfigModule } from './site-config/site-config.module';
import { CartModule } from './cart/cart.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TenantModule } from './tenant/tenant.module';
import { ThemeModule } from './theme/theme.module';
import { OrderModule } from './order/order.module';
import { TransactionModule } from './transaction/transaction.module';
import { PartnerModule } from './partner/partner.module';
import { CategoryModule } from './category/category.module';
import { ProductModule } from './product/product.module';
import { BrandModule } from './brand/brand.module';
import { UnitModule } from './unit/unit.module';
import { SupplierModule } from './supplier/supplier.module';
import { CurrencyModule } from './currency/currency.module';
import { PublicModule } from './public/public.module';
import { CheckoutModule } from './checkout/checkout.module';
import { UploadModule } from './upload/upload.module';
import { ReportModule } from './report/report.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KycSettingsModule } from './kyc/kyc-settings.module';
import { ChatModule } from './chat/chat.module';
import { AdminController } from './admin/admin.controller';
import { CloudinaryAccessService } from './admin/cloudinary-access.service';
import { AdminApiKeyGuard } from './authentication/guard/admin-api-key.guard';
import { AppController } from './app.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ActionLoggingInterceptor } from './common/interceptors/action-logging.interceptor';
import { TenantMiddleware } from './tenant/tenant.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Global Throttler configuration
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: 60000, // 1 minute
          limit: 100, // 100 requests per minute
        },
      ],
    }),
    AuthenticationAuthModule, // Full auth module with controllers
    AuthModule, // Simple auth module with JwtAuthGuard
    StaffModule,
    CustomerEmployeesModule,
    PrismaModule,
    EmailModule,
    RateLimitingModule,
    // API modules
    SiteConfigModule,
    CartModule,
    DashboardModule,
    NotificationsModule,
    TenantModule,
    ThemeModule,
    OrderModule,
    TransactionModule,
    PartnerModule,
    CategoryModule,
    ProductModule,
    BrandModule,
    UnitModule,
    SupplierModule,
    CurrencyModule,
    PublicModule,
    CheckoutModule,
    UploadModule,
    ReportModule,
    ActivityLogModule,
    SupportTicketsModule,
    IntegrationsModule,
    KycSettingsModule,
    ChatModule,
  ],
  controllers: [AppController, AdminController],
  providers: [
    CloudinaryAccessService,
    AdminApiKeyGuard,
    // Apply ThrottlerGuard globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Apply exception filter globally
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Apply action logging interceptor globally
    {
      provide: APP_INTERCEPTOR,
      useClass: ActionLoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Ensure tenant context is available on every request from headers/domain/JWT.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
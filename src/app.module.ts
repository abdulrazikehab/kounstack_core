import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { ActionLoggingInterceptor } from './common/interceptors/action-logging.interceptor';
import { MobileOptimizationInterceptor } from './common/interceptors/mobile-optimization.interceptor';
import { TenantModule } from './tenant/tenant.module';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { UserModule } from './user/user.module';
import { ProductModule } from './product/product.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';
import { TemplateModule } from './template/template.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { DomainModule } from './domain/domain.module';
import { CartModule } from './cart/cart.module';
import { InventoryModule } from './inventory/inventory.module';
import { CheckoutModule } from './checkout/checkout.module';
import { CollectionModule } from './collection/collection.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { UploadModule } from './upload/upload.module';
import { MediaModule } from './media/media.module';
import { RedisModule } from './redis/redis.module';
import { FraudModule } from './fraud/fraud.module';
import { FraudGuardMiddleware } from './fraud/fraud-guard.middleware';
import { securityConfig } from './config/security.config';
import { SeoModule } from './seo/seo.module';
import { ShippingModule } from './shipping/shipping.module';
import { TaxModule } from './tax/tax.module';
import { EventsModule } from './events/events.module';
import { WebhookModule } from './webhook/webhook.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { JobsModule } from './jobs/jobs.module';
import { PluginModule } from './plugin/plugin.module';
import { ThemeModule } from './theme/theme.module';
import { CouponModule } from './coupon/coupon.module';
import { PageModule } from './page/page.module';
import { AiModule } from './ai/ai.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SiteConfigModule } from './site-config/site-config.module';
import { SuperAdminGuard } from './guard/super-admin.guard';
import { AdminController } from './admin/admin.controller';
import { AppController } from './app.controller';
import { TransactionModule } from './transaction/transaction.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ChatModule } from './chat/chat.module';
import { ReportModule } from './report/report.module';
import { PartnerModule } from './partner/partner.module';
import { MasterAdminModule } from './admin/master-admin.module';
import { PublicModule } from './public/public.module';
import { SupplierModule } from './supplier/supplier.module';
import { EmailTemplatesModule } from './email-templates/email-templates.module';
import { BrandModule } from './brand/brand.module';
import { CurrencyModule } from './currency/currency.module';
import { UnitModule } from './unit/unit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CardsModule } from './cards/cards.module';
import { MerchantModule } from './merchant/merchant.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KycSettingsModule } from './kyc/kyc-settings.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { PurchaseLimitsModule } from './purchase-limits/purchase-limits.module';
import { ImportExportModule } from './import-export/import-export.module';
import { CustomerModule } from './customer/customer.module';
import { CustomerRegistrationRequestModule } from './customer-registration-request/customer-registration-request.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { AppBuilderModule } from './app-builder/app-builder.module';
import { MaintenanceGuard } from './guard/maintenance.guard';

@Module({
  // Main Application Module
  imports: [
    // Global configuration - updated to include root .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    // SECURITY FIX: Rate Limiting with different limits for different routes
    ThrottlerModule.forRoot([{
      ttl: securityConfig.rateLimit.default.ttl,
      limit: securityConfig.rateLimit.default.limit,
    }]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/static', // Serve files under /static path to avoid conflict with API
    }, {
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads', // Serve uploaded files
    }, {
      rootPath: join(process.cwd(), 'public', 'apks'), // Correctly serve the APKs directory
      serveRoot: '/apks',
    }),
    PrismaModule,
    // Global JWT module
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    // Feature modules
    AuthModule,
    TenantModule,
    UserModule,
    ProductModule,
    OrderModule,
    PaymentModule,
    TemplateModule,
    CategoryModule,
    DomainModule,
    CartModule,
    InventoryModule, // Added
    CheckoutModule,
    CollectionModule,
    CloudinaryModule,   
    UploadModule,      
    MediaModule,      
    RedisModule,
    FraudModule,
    SeoModule,
    ShippingModule,
    TaxModule,
    EventsModule,
    WebhookModule,
    AnalyticsModule,
    JobsModule,
    PluginModule, 
    ThemeModule,
    CouponModule, 
    PageModule,
    AiModule,
    DashboardModule,
    SiteConfigModule,
    TransactionModule,
    ActivityLogModule,
    ChatModule,
    ReportModule,
    PartnerModule,
    MasterAdminModule,
    PublicModule,
    SupplierModule,
    EmailTemplatesModule,
    BrandModule,
    CurrencyModule,
    UnitModule,
    NotificationsModule,
    CardsModule, // Digital Cards Marketplace
    MerchantModule, // Merchant Dealer App
    IntegrationsModule,
    KycSettingsModule,
    ApiKeyModule,
    PurchaseLimitsModule,
    ImportExportModule,
    CustomerModule,
    CustomerRegistrationRequestModule,
    SupportTicketsModule,
    AppBuilderModule,
  ],
  controllers: [AppController, AdminController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ActionLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MobileOptimizationInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
    consumer
      .apply(FraudGuardMiddleware)
      .forRoutes({ path: 'checkout/*', method: RequestMethod.POST }); // Apply only to checkout POST routes
  }
}
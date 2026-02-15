import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public prisma: any;
  refreshToken: any;

  constructor() {
    try {
      const { PrismaClient } = require('.prisma/client');
      this.prisma = new PrismaClient({
        log: ['query', 'info', 'warn', 'error'],
      });
      
      // Register Encryption Middleware
      try {
        const { EncryptionMiddleware } = require('./prisma-encryption.middleware');
        this.prisma.$use(EncryptionMiddleware);
        this.logger.log('Encryption Middleware registered');
      } catch (e) {
        this.logger.warn('Failed to register Encryption Middleware: ' + e);
      }

      this.logger.log('Core PrismaClient created successfully');
    } catch (error) {
      this.logger.error('Failed to create Core PrismaClient: ' + error);
      throw error;
    }
  }

  async onModuleInit() {
    try {
      await this.prisma.$connect();
      this.logger.log('Core Prisma connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to Core database: ' + error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
    this.logger.log('Core Prisma disconnected from database');
  }

  // Expose all Prisma models
  get user() { return this.prisma.user; }
  get tenant() { return this.prisma.tenant; }
  get product() { return this.prisma.product; }
  get productVariant() { return this.prisma.productVariant; }
  get productImage() { return this.prisma.productImage; }
  get category() { return this.prisma.category; }
  get productCategory() { return this.prisma.productCategory; }
  get order() { return this.prisma.order; }
  get orderItem() { return this.prisma.orderItem; }
  get customDomain() { return this.prisma.customDomain; }
  get cart() { return this.prisma.cart; }
  get cartItem() { return this.prisma.cartItem; }
  
  // Additional Models
  get productCollection() { return this.prisma.productCollection; }
  get productCollectionItem() { return this.prisma.productCollectionItem; }
  get productTag() { return this.prisma.productTag; }
  get productTagItem() { return this.prisma.productTagItem; }
  get coupon() { return this.prisma.coupon; }
  get couponRedemption() { return this.prisma.couponRedemption; }
  get shippingZone() { return this.prisma.shippingZone; }
  get shippingMethod() { return this.prisma.shippingMethod; }
  get taxRate() { return this.prisma.taxRate; }
  get paymentMethod() { return this.prisma.paymentMethod; }
  get sslCertificate() { return this.prisma.sslCertificate; }
  get webhookEndpoint() { return this.prisma.webhookEndpoint; }
  get webhookDelivery() { return this.prisma.webhookDelivery; }
  get payment() { return this.prisma.payment; }
  get refund() { return this.prisma.refund; }
  get theme() { return this.prisma.theme; }
  get themeVersion() { return this.prisma.themeVersion; }
  get plugin() { return this.prisma.plugin; }
  get page() { return this.prisma.page; }
  get pageHistory() { return this.prisma.pageHistory; }
  get template() { return this.prisma.template; }
  get siteConfig() { return this.prisma.siteConfig; }
  get activityLog() { return this.prisma.activityLog; }
  get chatMessage() { return this.prisma.chatMessage; }
  get transaction() { return this.prisma.transaction; }
  get notification() { return this.prisma.notification; }

  // Master Admin Models
  get partner() { return this.prisma.partner; }
  get auditLog() { return this.prisma.auditLog; }
  get platformFeature() { return this.prisma.platformFeature; }
  get userGift() { return this.prisma.userGift; }
  get subscriptionPlan() { return this.prisma.subscriptionPlan; }
  get featureFlag() { return this.prisma.featureFlag; }
  get platformConfig() { return this.prisma.platformConfig; }
  get paymentPlan() { return this.prisma.paymentPlan; }
  get integration() { return this.prisma.integration; }
  get securityEvent() { return this.prisma.securityEvent; }
  get supplier() { return this.prisma.supplier; }
  get brand() { return this.prisma.brand; }
  get unit() { return this.prisma.unit; }
  get currency() { return this.prisma.currency; }
  get currencySettings() { return this.prisma.currencySettings; }
  get productSupplier() { return this.prisma.productSupplier; }
  get supplierPurchase() { return this.prisma.supplierPurchase; }
  get apiKey() { return this.prisma.apiKey; }
  get complaint() { return this.prisma.complaint; }
  get systemVersion() { return this.prisma.systemVersion; }

  // Digital Cards Marketplace Models
  get cardProduct() { return this.prisma.cardProduct; }
  get cardInventory() { return this.prisma.cardInventory; }
  get cardOrder() { return this.prisma.cardOrder; }
  get cardOrderItem() { return this.prisma.cardOrderItem; }
  get cardDelivery() { return this.prisma.cardDelivery; }
  get wallet() { return this.prisma.wallet; }
  get walletTransaction() { return this.prisma.walletTransaction; }
  get walletTopUpRequest() { return this.prisma.walletTopUpRequest; }
  get bank() { return this.prisma.bank; }
  get bankAccount() { return this.prisma.bankAccount; }
  get merchantFavorite() { return this.prisma.merchantFavorite; }
  get supportTicket() { return this.prisma.supportTicket; }
  get ticketReply() { return this.prisma.ticketReply; }
  get cardBatch() { return this.prisma.cardBatch; }

  // Merchant Dealer App Models
  get merchant() { return this.prisma.merchant; }
  get employee() { return this.prisma.employee; }
  get player() { return this.prisma.player; }
  get playerGameAccount() { return this.prisma.playerGameAccount; }
  get merchantCart() { return this.prisma.merchantCart; }
  get merchantCartItem() { return this.prisma.merchantCartItem; }
  get merchantOrder() { return this.prisma.merchantOrder; }
  get merchantOrderItem() { return this.prisma.merchantOrderItem; }
  get merchantOrderDelivery() { return this.prisma.merchantOrderDelivery; }
  get merchantOrderEvent() { return this.prisma.merchantOrderEvent; }
  get paymentIntent() { return this.prisma.paymentIntent; }
  get invoice() { return this.prisma.invoice; }
  get promotion() { return this.prisma.promotion; }
  get merchantPromotionProgress() { return this.prisma.merchantPromotionProgress; }
  get priceAlertSubscription() { return this.prisma.priceAlertSubscription; }
  get productPriceHistory() { return this.prisma.productPriceHistory; }
  get merchantNotification() { return this.prisma.merchantNotification; }
  get merchantFavoriteV2() { return this.prisma.merchantFavoriteV2; }
  get merchantAuditLog() { return this.prisma.merchantAuditLog; }
  get merchantSession() { return this.prisma.merchantSession; }
  get merchantProductOverride() { return this.prisma.merchantProductOverride; }

  // Inventory Models
  get emergencyInventory() { return this.prisma.emergencyInventory; }
  get inventoryVisibilityOverride() { return this.prisma.inventoryVisibilityOverride; }
  get supplierProduct() { return this.prisma.supplierProduct; }

  // Purchase Limits Models
  get purchaseLimits() { return this.prisma.purchaseLimits; }
  get tenantPaymentOption() { return this.prisma.tenantPaymentOption; }

  // Customer Registration Request Model
  get customerRegistrationRequest() { return this.prisma.customerRegistrationRequest; }

  $transaction(p: any) {
    return this.prisma.$transaction(p);
  }
}
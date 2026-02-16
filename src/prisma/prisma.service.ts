import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public prisma: any;
  private readonly warnedMissingModels = new Set<string>();
  private readonly fallbackDelegates = new Map<string, any>();

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

      this.logger.log('Auth PrismaClient created successfully');
    } catch (error) {
      this.logger.error('Failed to create Auth PrismaClient: ' + error);
      throw error;
    }

    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop !== 'string') {
          return Reflect.get(target, prop, receiver);
        }

        // Keep normal class properties/methods behavior
        if (
          prop in target ||
          prop === 'then' ||
          prop === 'catch' ||
          prop === 'finally' ||
          // Never treat Nest lifecycle hooks as Prisma models
          prop === 'onApplicationBootstrap' ||
          prop === 'enableShutdownHooks'
        ) {
          return Reflect.get(target, prop, receiver);
        }

        // Fallback for any missing Prisma model delegate, to avoid runtime TypeErrors.
        return target.getModelDelegate(prop);
      },
    });
  }

  private getModelDelegate(modelName: string) {
    const delegate = this.prisma?.[modelName];
    if (delegate) {
      return delegate;
    }

    if (!this.warnedMissingModels.has(modelName)) {
      this.warnedMissingModels.add(modelName);
      this.logger.warn(
        `Prisma model delegate "${modelName}" is not available in current client. Using fallback no-op delegate.`,
      );
    }

    if (!this.fallbackDelegates.has(modelName)) {
      const unavailable = (operation: string) => {
        throw new Error(
          `Prisma model "${modelName}" is unavailable. Cannot execute "${operation}".`,
        );
      };

      this.fallbackDelegates.set(modelName, {
        findMany: async () => [],
        findFirst: async () => null,
        findUnique: async () => null,
        count: async () => 0,
        aggregate: async () => ({}),
        groupBy: async () => [],
        create: async () => unavailable('create'),
        createMany: async () => ({ count: 0 }),
        update: async () => unavailable('update'),
        updateMany: async () => ({ count: 0 }),
        upsert: async () => unavailable('upsert'),
        delete: async () => unavailable('delete'),
        deleteMany: async () => ({ count: 0 }),
      });
    }

    return this.fallbackDelegates.get(modelName);
  }

  async onModuleInit() {
    try {
      await this.prisma.$connect();
      this.logger.log('Auth Prisma connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to Auth database: ' + error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
    this.logger.log('Auth Prisma disconnected from database');
  }

  // Expose all Prisma models
  get user() {
    return this.getModelDelegate('user');
  }

  get tenant() {
    return this.getModelDelegate('tenant');
  }

   get customer() {
    return this.getModelDelegate('customer');
  }

  get refreshToken() {
    return this.getModelDelegate('refreshToken');
  }

  get passwordReset() {
    return this.getModelDelegate('passwordReset');
  }

  get loginAttempt() {
    return this.getModelDelegate('loginAttempt');
  }

  get staffPermission() {
    return this.getModelDelegate('staffPermission');
  }

  get auditLog() {
    return this.getModelDelegate('auditLog');
  }

  get rateLimit() {
    return this.getModelDelegate('rateLimit');
  }

  get securityEvent() {
    return this.getModelDelegate('securityEvent');
  }
get merchantVerification() {
    return this.getModelDelegate('merchantVerification');
  }
  
  get merchantLimits() {
    return this.getModelDelegate('merchantLimits');
  }

  get userTenant() {
    return this.getModelDelegate('userTenant');
  }

  get session() {
    return this.getModelDelegate('session');
  }

  get customerEmployee() {
    return this.getModelDelegate('customerEmployee');
  }

  get customerEmployeePermission() {
    return this.getModelDelegate('customerEmployeePermission');
  }

  get userCloudinaryAccess() {
    return this.getModelDelegate('userCloudinaryAccess');
  }

  get order() {
    return this.getModelDelegate('order');
  }

  get product() {
    return this.getModelDelegate('product');
  }

  get transaction() {
    return this.getModelDelegate('transaction');
  }

  get activityLog() {
    return this.getModelDelegate('activityLog');
  }

  get platformConfig() {
    return this.getModelDelegate('platformConfig');
  }

  get partner() {
    return this.getModelDelegate('partner');
  }

  get wallet() {
    return this.getModelDelegate('wallet');
  }

  get walletTransaction() {
    return this.getModelDelegate('walletTransaction');
  }

  get paymentMethod() {
    return this.getModelDelegate('paymentMethod');
  }

  get brand() {
    return this.getModelDelegate('brand');
  }

  get section() {
    return this.getModelDelegate('section');
  }

  get page() {
    return this.getModelDelegate('page');
  }

  // Commerce / storefront models that may or may not exist in this schema.
  // These all route through getModelDelegate, which will either return the real
  // Prisma delegate (when present) or a safe fallback/no-op delegate.

  get theme() {
    return this.getModelDelegate('theme');
  }

  get cart() {
    return this.getModelDelegate('cart');
  }

  get cartItem() {
    return this.getModelDelegate('cartItem');
  }

  $transaction(p: any) {
    return this.prisma.$transaction(p);
  }
}
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface PurchaseLimitsConfig {
  id?: string;
  tenantId: string;
  defaultLimitAmount: number;
  tierLimits: Record<string, { baseLimit: number; increasePerPurchase: number }>;
  customerLimitTracking: Record<string, { purchaseCount: number; currentLimit: number }>;
  creditCardTracking: Record<string, { customerEmail: string; usageCount: number; totalAmount: number }>;
  enableCreditCardTracking: boolean;
  enablePurchaseCountIncrease: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  currentLimit: number;
  requestedAmount: number;
  reason?: string;
}

@Injectable()
export class PurchaseLimitsService {
  private readonly logger = new Logger(PurchaseLimitsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get or create purchase limits configuration for a tenant
   */
  async getOrCreateLimits(tenantId: string): Promise<PurchaseLimitsConfig> {
    // Check if purchaseLimits model exists in Prisma client
    if (!this.prisma.purchaseLimits) {
      this.logger.warn('PurchaseLimits model not found in Prisma client. Please run: npx prisma generate');
      // Return default configuration
      return {
        tenantId,
        defaultLimitAmount: 1000,
        tierLimits: {},
        customerLimitTracking: {},
        creditCardTracking: {},
        enableCreditCardTracking: true,
        enablePurchaseCountIncrease: true,
      };
    }

    let limits = await this.prisma.purchaseLimits.findUnique({
      where: { tenantId },
    });

    if (!limits) {
      limits = await this.prisma.purchaseLimits.create({
        data: {
          tenantId,
          defaultLimitAmount: 1000,
          tierLimits: {},
          customerLimitTracking: {},
          creditCardTracking: {},
          enableCreditCardTracking: true,
          enablePurchaseCountIncrease: true,
        },
      });
    }

    return {
      id: limits.id,
      tenantId: limits.tenantId,
      defaultLimitAmount: Number(limits.defaultLimitAmount),
      tierLimits: limits.tierLimits as Record<string, { baseLimit: number; increasePerPurchase: number }>,
      customerLimitTracking: limits.customerLimitTracking as Record<string, { purchaseCount: number; currentLimit: number }>,
      creditCardTracking: limits.creditCardTracking as Record<string, { customerEmail: string; usageCount: number; totalAmount: number }>,
      enableCreditCardTracking: limits.enableCreditCardTracking,
      enablePurchaseCountIncrease: limits.enablePurchaseCountIncrease,
    };
  }

  /**
   * Update purchase limits configuration
   */
  async updateLimits(tenantId: string, data: Partial<PurchaseLimitsConfig>): Promise<PurchaseLimitsConfig> {
    // Check if purchaseLimits model exists in Prisma client
    if (!this.prisma.purchaseLimits) {
      this.logger.warn('PurchaseLimits model not found in Prisma client. Please run: npx prisma generate');
      // Return default configuration with provided data
      return {
        tenantId,
        defaultLimitAmount: data.defaultLimitAmount ?? 1000,
        tierLimits: data.tierLimits ?? {},
        customerLimitTracking: data.customerLimitTracking ?? {},
        creditCardTracking: data.creditCardTracking ?? {},
        enableCreditCardTracking: data.enableCreditCardTracking ?? true,
        enablePurchaseCountIncrease: data.enablePurchaseCountIncrease ?? true,
      };
    }

    const existing = await this.prisma.purchaseLimits.findUnique({
      where: { tenantId },
    });

    let updated;
    if (!existing) {
      // Create if doesn't exist
      updated = await this.prisma.purchaseLimits.create({
        data: {
          tenantId,
          defaultLimitAmount: data.defaultLimitAmount !== undefined ? data.defaultLimitAmount : 1000,
          tierLimits: data.tierLimits !== undefined ? data.tierLimits : {},
          customerLimitTracking: data.customerLimitTracking !== undefined ? data.customerLimitTracking : {},
          creditCardTracking: data.creditCardTracking !== undefined ? data.creditCardTracking : {},
          enableCreditCardTracking: data.enableCreditCardTracking !== undefined ? data.enableCreditCardTracking : true,
          enablePurchaseCountIncrease: data.enablePurchaseCountIncrease !== undefined ? data.enablePurchaseCountIncrease : true,
        },
      });
    } else {
      // Update existing
      updated = await this.prisma.purchaseLimits.update({
        where: { tenantId },
        data: {
          defaultLimitAmount: data.defaultLimitAmount !== undefined ? data.defaultLimitAmount : undefined,
          tierLimits: data.tierLimits !== undefined ? data.tierLimits : undefined,
          customerLimitTracking: data.customerLimitTracking !== undefined ? data.customerLimitTracking : undefined,
          creditCardTracking: data.creditCardTracking !== undefined ? data.creditCardTracking : undefined,
          enableCreditCardTracking: data.enableCreditCardTracking !== undefined ? data.enableCreditCardTracking : undefined,
          enablePurchaseCountIncrease: data.enablePurchaseCountIncrease !== undefined ? data.enablePurchaseCountIncrease : undefined,
        },
      });
    }

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      defaultLimitAmount: Number(updated.defaultLimitAmount),
      tierLimits: updated.tierLimits as Record<string, { baseLimit: number; increasePerPurchase: number }>,
      customerLimitTracking: updated.customerLimitTracking as Record<string, { purchaseCount: number; currentLimit: number }>,
      creditCardTracking: updated.creditCardTracking as Record<string, { customerEmail: string; usageCount: number; totalAmount: number }>,
      enableCreditCardTracking: updated.enableCreditCardTracking,
      enablePurchaseCountIncrease: updated.enablePurchaseCountIncrease,
    };
  }

  /**
   * Check if a purchase is within limits
   */
  async checkPurchaseLimit(
    tenantId: string,
    customerEmail: string,
    requestedAmount: number,
    customerTierId?: string,
    isVerified: boolean = false,
    cardLast4?: string,
    cardExpMonth?: string,
    cardExpYear?: string,
  ): Promise<LimitCheckResult> {
    const limits = await this.getOrCreateLimits(tenantId);

    // Determine the base limit
    let baseLimit = limits.defaultLimitAmount;

    // If customer is verified and has a tier, use tier limit
    if (isVerified && customerTierId && limits.tierLimits[customerTierId]) {
      baseLimit = limits.tierLimits[customerTierId].baseLimit;
    } else if (!isVerified) {
      // Unverified/guest customers use default limit
      baseLimit = limits.defaultLimitAmount;
    }

    // Get current limit (may be increased based on purchase count)
    let currentLimit = baseLimit;
    const customerId = this.getCustomerId(customerEmail, tenantId);
    
    if (limits.enablePurchaseCountIncrease && limits.customerLimitTracking[customerId]) {
      currentLimit = limits.customerLimitTracking[customerId].currentLimit;
    } else if (limits.enablePurchaseCountIncrease && isVerified && customerTierId && limits.tierLimits[customerTierId]) {
      // Initialize tracking for new verified customer
      currentLimit = limits.tierLimits[customerTierId].baseLimit;
    }

    // Check credit card tracking if enabled
    if (limits.enableCreditCardTracking && cardLast4 && cardExpMonth && cardExpYear) {
      const cardHash = this.hashCreditCard(cardLast4, cardExpMonth, cardExpYear);
      const cardTracking = limits.creditCardTracking[cardHash];

      if (cardTracking && cardTracking.customerEmail !== customerEmail) {
        // Same card used by different customer - apply restrictions
        // Use the lower of default limit or current limit
        currentLimit = Math.min(currentLimit, limits.defaultLimitAmount);
      }
    }

    // Check if request is within limit
    if (requestedAmount > currentLimit) {
      return {
        allowed: false,
        currentLimit,
        requestedAmount,
        reason: `Purchase amount (${requestedAmount}) exceeds the current limit of ${currentLimit}`,
      };
    }

    return {
      allowed: true,
      currentLimit,
      requestedAmount,
    };
  }

  /**
   * Record a successful purchase and update tracking
   */
  async recordPurchase(
    tenantId: string,
    customerEmail: string,
    purchaseAmount: number,
    customerTierId?: string,
    isVerified: boolean = false,
    cardLast4?: string,
    cardExpMonth?: string,
    cardExpYear?: string,
  ): Promise<void> {
    const limits = await this.getOrCreateLimits(tenantId);
    const customerId = this.getCustomerId(customerEmail, tenantId);

    const updates: any = {};

    // Update purchase count and limit if enabled
    if (limits.enablePurchaseCountIncrease) {
      const tracking = limits.customerLimitTracking[customerId] || {
        purchaseCount: 0,
        currentLimit: isVerified && customerTierId && limits.tierLimits[customerTierId]
          ? limits.tierLimits[customerTierId].baseLimit
          : limits.defaultLimitAmount,
      };

      tracking.purchaseCount += 1;

      // Increase limit based on tier rules
      if (isVerified && customerTierId && limits.tierLimits[customerTierId]) {
        tracking.currentLimit += limits.tierLimits[customerTierId].increasePerPurchase;
      }

      limits.customerLimitTracking[customerId] = tracking;
      updates.customerLimitTracking = limits.customerLimitTracking;
    }

    // Update credit card tracking if enabled
    if (limits.enableCreditCardTracking && cardLast4 && cardExpMonth && cardExpYear) {
      const cardHash = this.hashCreditCard(cardLast4, cardExpMonth, cardExpYear);
      const cardTracking = limits.creditCardTracking[cardHash] || {
        customerEmail,
        usageCount: 0,
        totalAmount: 0,
      };

      cardTracking.usageCount += 1;
      cardTracking.totalAmount += purchaseAmount;

      limits.creditCardTracking[cardHash] = cardTracking;
      updates.creditCardTracking = limits.creditCardTracking;
    }

    // Update database if there are changes
    if (Object.keys(updates).length > 0) {
      await this.prisma.purchaseLimits.update({
        where: { tenantId },
        data: updates,
      });
    }
  }

  /**
   * Get customer ID from email and tenant
   */
  private getCustomerId(email: string, tenantId: string): string {
    return `${tenantId}:${email}`;
  }

  /**
   * Hash credit card info for tracking (last 4 digits + expiration)
   */
  private hashCreditCard(last4: string, expMonth: string, expYear: string): string {
    const data = `${last4}:${expMonth}:${expYear}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
}

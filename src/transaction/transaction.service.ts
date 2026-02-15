import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TransactionStatus } from '@prisma/client';
import { getDefaultCurrency } from '../common/utils/currency.util';
import { WalletService } from '../cards/wallet.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';


@Injectable()
export class TransactionService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}


  /**
   * Get tenant balance summary
   */
  async getTenantBalance(tenantId: string) {
    const defaultCurrency = await getDefaultCurrency(this.prisma, tenantId);
    
    const transactions = await this.prisma.transaction.findMany({
      where: { tenantId },
      select: {
        amount: true,
        platformFee: true,
        merchantEarnings: true,
        status: true,
        currency: true,
      },
    });

    // Calculate totals in default currency (convert other currencies if needed)
    const totalRevenue = transactions
      .filter((t: any) => t.status === 'COMPLETED')
      .reduce((sum: number, t: any) => {
        // If transaction is in default currency, add directly
        // Otherwise, you might want to convert using exchange rates
        // For now, we'll sum all amounts regardless of currency
        return sum + Number(t.amount);
      }, 0);

    const totalPlatformFees = transactions
      .filter((t: any) => t.status === 'COMPLETED')
      .reduce((sum: number, t: any) => sum + Number(t.platformFee), 0);

    const totalEarnings = transactions
      .filter((t: any) => t.status === 'COMPLETED')
      .reduce((sum: number, t: any) => sum + Number(t.merchantEarnings), 0);

    const pendingAmount = transactions
      .filter((t: any) => t.status === 'PENDING' || t.status === 'PROCESSING')
      .reduce((sum: number, t: any) => sum + Number(t.merchantEarnings), 0);

    // Get unique currencies used in transactions
    const currenciesUsed = Array.from(
      new Set(transactions.map((t: any) => t.currency || defaultCurrency))
    );

    return {
      totalRevenue,
      totalPlatformFees,
      totalEarnings,
      pendingAmount,
      availableBalance: totalEarnings,
      currency: defaultCurrency,
      currenciesUsed, // List of all currencies used in transactions
    };
  }

  /**
   * Get all transactions for a tenant with filters
   */
  async getTransactions(
    tenantId: string,
    filters?: {
      status?: TransactionStatus;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.TransactionWhereInput = {
      tenantId,
      ...(filters?.status && { status: filters.status }),
      ...(filters?.startDate &&
        filters?.endDate && {
          createdAt: {
            gte: filters.startDate,
            lte: filters.endDate,
          },
        }),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          order: {
            select: {
              orderNumber: true,
              customerName: true,
              customerEmail: true,
              orderItems: {
                select: {
                  productName: true,
                  quantity: true,
                  price: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((t: any) => ({
        id: t.id,
        orderNumber: t.orderNumber || t.order?.orderNumber,
        amount: Number(t.amount),
        platformFee: Number(t.platformFee),
        merchantEarnings: Number(t.merchantEarnings),
        currency: t.currency,
        status: t.status,
        paymentProvider: t.paymentProvider,
        paymentMethodType: t.paymentMethodType,
        customerEmail: t.customerEmail || t.order?.customerEmail,
        customerName: t.customerName || t.order?.customerName,
        description: t.description,
        orderItems: t.order?.orderItems || [],
        processedAt: t.processedAt,
        settledAt: t.settledAt,
        createdAt: t.createdAt,
        // Card details (from metadata)
        cardNumber: (t.metadata as any)?.cardNumber,
        cardBin: (t.metadata as any)?.cardBin,
        cardLast4: (t.metadata as any)?.cardLast4,
        // Print tracking (from metadata)
        printCount: (t.metadata as any)?.printCount || 0,
      })),
      total,
      limit: filters?.limit || 50,
      offset: filters?.offset || 0,
    };
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(tenantId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        tenantId,
      },
      include: {
        order: {
          include: {
            orderItems: {
              include: {
                product: {
                  select: {
                    name: true,
                    images: {
                      take: 1,
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    return {
      ...transaction,
      amount: Number(transaction.amount),
      platformFee: Number(transaction.platformFee),
      merchantEarnings: Number(transaction.merchantEarnings),
    };
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where: Prisma.TransactionWhereInput = {
      tenantId,
      status: 'COMPLETED',
      ...(startDate &&
        endDate && {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        }),
    };

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: {
        amount: true,
        platformFee: true,
        merchantEarnings: true,
        paymentProvider: true,
        createdAt: true,
      },
    });

    // Group by payment provider
    const byProvider = transactions.reduce(
      (acc: any, t: any) => {
        const provider = t.paymentProvider;
        if (!acc[provider]) {
          acc[provider] = { count: 0, amount: 0 };
        }
        acc[provider].count++;
        acc[provider].amount += Number(t.amount);
        return acc;
      },
      {} as Record<string, { count: number; amount: number }>,
    );

    // Group by date
    const byDate = transactions.reduce(
      (acc: any, t: any) => {
        const date = t.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { count: 0, amount: 0, fees: 0, earnings: 0 };
        }
        acc[date].count++;
        acc[date].amount += Number(t.amount);
        acc[date].fees += Number(t.platformFee);
        acc[date].earnings += Number(t.merchantEarnings);
        return acc;
      },
      {} as Record<
        string,
        { count: number; amount: number; fees: number; earnings: number }
      >,
    );

    return {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce(
        (sum: number, t: any) => sum + Number(t.amount),
        0,
      ),
      totalFees: transactions.reduce(
        (sum: number, t: any) => sum + Number(t.platformFee),
        0,
      ),
      totalEarnings: transactions.reduce(
        (sum: number, t: any) => sum + Number(t.merchantEarnings),
        0,
      ),
      byProvider,
      byDate: Object.entries(byDate).map(([date, data]: [string, any]) => {
        const dataObj = data && typeof data === 'object' ? data : {};
        return {
          date,
          ...dataObj,
        };
      }),
    };
  }

  /**
   * Reprint transaction receipt and increment print count
   */
  async reprintTransaction(tenantId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        tenantId,
      },
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Increment print count
    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        // Use raw SQL increment since printCount might not be in schema yet
        metadata: {
          ...(transaction.metadata as object || {}),
          printCount: ((transaction.metadata as any)?.printCount || 0) + 1,
          lastPrintedAt: new Date().toISOString(),
        },
      },
    });

    return {
      success: true,
      printCount: ((updated.metadata as any)?.printCount || 1),
      transactionId: transaction.id,
      orderNumber: transaction.orderNumber,
    };
  }

  /**
   * Get subscription info for tenant
   */
  async getSubscriptionInfo(tenantId: string) {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          plan: true,
          createdAt: true,
          settings: true,
        },
      });

      if (!tenant) {
        // Return default subscription info if tenant not found
        return {
          plan: 'STARTER',
          monthlyPrice: 0,
          features: [],
          nextBillingDate: new Date(),
          daysUntilBilling: 0,
          shouldAlert: false,
          billingHistory: [],
        };
      }

      // Calculate next billing date (assuming monthly billing)
      const nextBillingDate = new Date(tenant.createdAt);
      const today = new Date();
      
      while (nextBillingDate < today) {
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
      }

      const daysUntilBilling = Math.ceil(
        (nextBillingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Plan pricing
      const planPricing: Record<string, { monthly: number; features: string[] }> = {
        STARTER: { monthly: 99, features: ['Up to 100 products', 'Basic analytics', 'Email support'] },
        PROFESSIONAL: { monthly: 299, features: ['Unlimited products', 'Advanced analytics', 'Priority support', 'Custom domain'] },
        ENTERPRISE: { monthly: 999, features: ['Everything in Pro', 'Dedicated account manager', 'Custom integrations', 'SLA'] },
      };

      const plan = tenant.plan || 'STARTER';
      const currentPlan = planPricing[plan] || planPricing.STARTER;

      return {
        plan,
        monthlyPrice: currentPlan.monthly,
        features: currentPlan.features,
        nextBillingDate,
        daysUntilBilling,
        shouldAlert: daysUntilBilling <= 7,
        billingHistory: [], // TODO: Implement billing history
      };
    } catch (error) {
      console.error('Error fetching subscription info:', error);
      // Return default subscription info on error
      return {
        plan: 'STARTER',
        monthlyPrice: 0,
        features: [],
        nextBillingDate: new Date(),
        daysUntilBilling: 0,
        shouldAlert: false,
        billingHistory: [],
      };
    }
  }

  /**
   * Refund a transaction
   */
  async refundTransaction(tenantId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        tenantId,
      },
      include: {
        order: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status === 'REFUNDED') {
      throw new BadRequestException('Transaction is already refunded');
    }

    if (transaction.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed transactions can be refunded');
    }

    // Start a transaction to ensure atomicity
    return this.prisma.$transaction(async (prisma) => {
      // 1. Update transaction status
      const updatedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'REFUNDED',
          metadata: {
            ...(transaction.metadata as object || {}),
            refundedAt: new Date().toISOString(),
          },
        },
      });

      // 2. If it was a wallet payment, refund the amount to the user's wallet
      if (transaction.paymentMethodType === 'WALLET' && transaction.userId) {
        await this.walletService.credit(
          transaction.userId,
          Number(transaction.amount),
          `Refund for transaction ${transaction.id}`,
          `استرجاع للمعاملة ${transaction.id}`,
          transaction.id,
          'REFUND'
        );
      }

      // 3. Update associated order status if it exists
      if (transaction.orderId) {
        await prisma.order.update({
          where: { id: transaction.orderId },
          data: {
            status: 'CANCELLED', // Or a specific REFUNDED status if available
            paymentStatus: 'REFUNDED',
          },
        });
      }

      return {
        success: true,
        message: 'Transaction refunded successfully',
        transaction: updatedTransaction,
      };
    });
  }
}


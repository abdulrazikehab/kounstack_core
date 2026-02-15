import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportDateRangeQuery } from '../dto';

@Injectable()
export class MerchantReportService {
  private readonly logger = new Logger(MerchantReportService.name);

  constructor(private prisma: PrismaService) {}

  // Get date range from query
  private getDateRange(query: ReportDateRangeQuery): { from: Date; to: Date } {
    const now = new Date();
    let from: Date;
    let to: Date = now;

    if (query.from && query.to) {
      from = new Date(query.from);
      to = new Date(query.to);
    } else {
      switch (query.range) {
        case 'today':
          from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'total':
        default:
          from = new Date(0); // Beginning of time
          break;
      }
    }

    return { from, to };
  }

  // Dashboard home data
  async getDashboardHome(merchantId: string, userId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get wallet balance
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    // Today's orders
    const todayOrders = await this.prisma.merchantOrder.findMany({
      where: {
        merchantId,
        status: 'COMPLETED',
        createdAt: { gte: todayStart },
      },
    });

    const todayOrdersCount = todayOrders.length;
    const todayProfit = todayOrders.reduce((sum: number, o: any) => sum + Number(o.profitTotal), 0);

    // Pending orders count
    const pendingOrdersCount = await this.prisma.merchantOrder.count({
      where: { merchantId, status: { in: ['PENDING', 'PROCESSING'] } },
    });

    // Top selling products (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const topProducts = await this.prisma.merchantOrderItem.groupBy({
      by: ['productId'],
      where: {
        order: { merchantId, status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } },
      },
      _sum: { quantity: true, lineTotal: true, lineProfit: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });

    const productIds = topProducts.map((p: any) => p.productId);
    const products = await this.prisma.cardProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, nameAr: true, image: true },
    });

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    // Recent orders
    const recentOrders = await this.prisma.merchantOrder.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, orderNumber: true, status: true, total: true, createdAt: true },
    });

    // Active promotions with progress
    const activePromotions = await this.prisma.promotion.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      take: 3,
    });

    const progressRecords = await this.prisma.merchantPromotionProgress.findMany({
      where: {
        merchantId,
        promotionId: { in: activePromotions.map((p: any) => p.id) },
      },
    });

    const progressMap = new Map(progressRecords.map((p: any) => [p.promotionId, p]));

    // Unread notifications count
    const unreadNotificationsCount = await this.prisma.merchantNotification.count({
      where: { merchantId, readAt: null },
    });

    return {
      walletBalance: wallet ? Number(wallet.balance) : 0,
      currency: 'SAR',
      todayOrdersCount,
      todayProfit,
      pendingOrdersCount,
      topSellingProducts: topProducts.map((tp: any) => {
        const product = productMap.get(tp.productId) as { name?: string; nameAr?: string; image?: string } | undefined;
        return {
          productId: tp.productId,
          name: product?.name || 'Unknown',
          nameAr: product?.nameAr,
          image: product?.image,
          qty: tp._sum.quantity || 0,
          revenue: Number(tp._sum.lineTotal || 0),
          profit: Number(tp._sum.lineProfit || 0),
        };
      }),
      recentOrders: recentOrders.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: Number(o.total),
        createdAt: o.createdAt,
      })),
      activePromotions: activePromotions.map((p: any) => {
        const progress = progressMap.get(p.id) as { progress?: any; isCompleted?: boolean; completedAt?: Date; rewardClaimed?: boolean } | undefined;
        const conditions = p.conditions as any;
        const progressData = (progress?.progress as any) || {};
        
        let percentage = 0;
        if (conditions.minOrders) {
          percentage = Math.min(100, ((progressData.ordersCount || 0) / conditions.minOrders) * 100);
        } else if (conditions.minVolume) {
          percentage = Math.min(100, ((progressData.volume || 0) / conditions.minVolume) * 100);
        }

        return {
          id: p.id,
          title: p.titleEn,
          titleAr: p.titleAr,
          progressPercentage: Math.round(percentage),
          endsAt: p.endAt,
        };
      }),
      unreadNotificationsCount,
    };
  }

  // Profit report
  async getProfitReport(merchantId: string, query: ReportDateRangeQuery) {
    const { from, to } = this.getDateRange(query);

    const orders = await this.prisma.merchantOrder.findMany({
      where: {
        merchantId,
        status: 'COMPLETED',
        createdAt: { gte: from, lte: to },
      },
      select: {
        total: true,
        profitTotal: true,
        createdAt: true,
      },
    });

    const profitTotal = orders.reduce((sum: number, o: any) => sum + Number(o.profitTotal), 0);
    const revenueTotal = orders.reduce((sum: number, o: any) => sum + Number(o.total), 0);
    const ordersCount = orders.length;

    // Group by day for breakdown
    const breakdown: Map<string, { profit: number; revenue: number; ordersCount: number }> = new Map();
    
    for (const order of orders) {
      const dateKey = order.createdAt.toISOString().split('T')[0];
      const existing = breakdown.get(dateKey) || { profit: 0, revenue: 0, ordersCount: 0 };
      existing.profit += Number(order.profitTotal);
      existing.revenue += Number(order.total);
      existing.ordersCount += 1;
      breakdown.set(dateKey, existing);
    }

    return {
      profitTotal,
      revenueTotal,
      ordersCount,
      currency: 'SAR',
      breakdown: Array.from(breakdown.entries()).map(([date, data]) => ({
        date,
        ...data,
      })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // Top profitable products
  async getTopProfitableProducts(merchantId: string, query: ReportDateRangeQuery & { limit?: number }) {
    const { from, to } = this.getDateRange(query);
    const limit = query.limit || 10;

    const topProducts = await this.prisma.merchantOrderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          merchantId,
          status: 'COMPLETED',
          createdAt: { gte: from, lte: to },
        },
      },
      _sum: { quantity: true, lineTotal: true, lineProfit: true },
      orderBy: { _sum: { lineProfit: 'desc' } },
      take: limit,
    });

    const productIds = topProducts.map((p: any) => p.productId);
    const products = await this.prisma.cardProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, nameAr: true, image: true },
    });

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    return {
      products: topProducts.map((tp: any) => {
        const product = productMap.get(tp.productId) as { name?: string; nameAr?: string; image?: string } | undefined;
        return {
          productId: tp.productId,
          name: product?.name || 'Unknown',
          nameAr: product?.nameAr,
          image: product?.image,
          profit: Number(tp._sum.lineProfit || 0),
          qty: tp._sum.quantity || 0,
          revenue: Number(tp._sum.lineTotal || 0),
        };
      }),
    };
  }

  // Top selling products (ordered by quantity)
  async getTopSellingProducts(merchantId: string, query: ReportDateRangeQuery & { limit?: number }) {
    const { from, to } = this.getDateRange(query);
    const limit = query.limit || 10;

    const topProducts = await this.prisma.merchantOrderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          merchantId,
          status: 'COMPLETED',
          createdAt: { gte: from, lte: to },
        },
      },
      _sum: { quantity: true, lineTotal: true, lineProfit: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });

    const productIds = topProducts.map((p: any) => p.productId);
    const products = await this.prisma.cardProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, nameAr: true, image: true },
    });

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    return {
      products: topProducts.map((tp: any) => {
        const product = productMap.get(tp.productId) as { name?: string; nameAr?: string; image?: string } | undefined;
        return {
          productId: tp.productId,
          name: product?.name || 'Unknown',
          nameAr: product?.nameAr,
          image: product?.image,
          qty: tp._sum.quantity || 0,
          revenue: Number(tp._sum.lineTotal || 0),
          profit: Number(tp._sum.lineProfit || 0),
        };
      }),
    };
  }

  // Price changes report
  async getPriceChangesReport(merchantId: string, query: { productId?: string; from?: string; to?: string }) {
    const where: any = {};

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.from || query.to) {
      where.changedAt = {};
      if (query.from) where.changedAt.gte = new Date(query.from);
      if (query.to) where.changedAt.lte = new Date(query.to);
    }

    const changes = await this.prisma.productPriceHistory.findMany({
      where,
      include: {
        product: { select: { name: true, nameAr: true } },
      },
      orderBy: { changedAt: 'desc' },
      take: 100,
    });

    return {
      changes: changes.map((c: any) => ({
        productId: c.productId,
        productName: c.product.name,
        productNameAr: c.product.nameAr,
        oldPrice: Number(c.oldPrice),
        newPrice: Number(c.newPrice),
        changePercent: ((Number(c.newPrice) - Number(c.oldPrice)) / Number(c.oldPrice) * 100),
        changedAt: c.changedAt,
        reason: c.reason,
      })),
    };
  }
}


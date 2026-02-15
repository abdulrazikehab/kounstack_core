import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrderStats(tenantId: string) {
    const totalOrders = await this.prisma.order.count({
      where: { tenantId },
    });

    const revenue = await this.prisma.order.aggregate({
      where: { 
        tenantId,
        paymentStatus: 'SUCCEEDED'
      },
      _sum: {
        totalAmount: true,
      },
    });

    const totalRevenue = Number(revenue._sum.totalAmount) || 0;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Count orders by status
    const ordersByStatus = await this.prisma.order.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
    });

    const ordersByStatusMap: Record<string, number> = {};
    ordersByStatus.forEach((group: any) => {
      ordersByStatusMap[group.status] = group._count.id;
    });

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue: Number(averageOrderValue.toFixed(2)),
      ordersByStatus: {
        PENDING: ordersByStatusMap.PENDING || 0,
        PROCESSING: ordersByStatusMap.PROCESSING || 0,
        SHIPPED: ordersByStatusMap.SHIPPED || 0,
        DELIVERED: ordersByStatusMap.DELIVERED || 0,
        CANCELLED: ordersByStatusMap.CANCELLED || 0,
      },
    };
  }

  async getProductStats(tenantId: string) {
    const totalProducts = await this.prisma.product.count({
      where: { tenantId },
    });

    const lowStockProducts = await this.prisma.productVariant.count({
      where: { 
        product: { tenantId },
        trackInventory: true,
        inventoryQuantity: { lte: 5 }
      }
    });

    return {
      totalProducts,
      lowStockProducts,
    };
  }

  async getDashboardStats(tenantId: string) {
    const [orderStats, productStats] = await Promise.all([
      this.getOrderStats(tenantId),
      this.getProductStats(tenantId),
    ]);

    return {
      ...orderStats,
      ...productStats,
    };
  }

  async getTrafficStats(tenantId: string) {
    // Placeholder for now as we don't track page views in DB yet
    // Could be implemented with Redis or a separate analytics table
    return {
      totalVisits: 0,
      uniqueVisitors: 0,
      pageViews: 0,
      bounceRate: 0,
      averageSessionDuration: 0,
    };
  }

  async getCustomerStats(tenantId: string) {
    // Count unique customers from orders
    const uniqueCustomers = await this.prisma.order.groupBy({
      by: ['customerEmail'],
      where: { tenantId },
    });

    return {
      totalCustomers: uniqueCustomers.length,
      newCustomers: 0, // Could be calculated based on first order date
    };
  }

  async getRevenueStats(tenantId: string) {
    const revenue = await this.prisma.order.aggregate({
      where: { 
        tenantId,
        paymentStatus: 'SUCCEEDED'
      },
      _sum: {
        totalAmount: true,
      },
    });

    const totalOrders = await this.prisma.order.count({
      where: { 
        tenantId,
        paymentStatus: 'SUCCEEDED'
      },
    });

    return {
      totalRevenue: Number(revenue._sum.totalAmount) || 0,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? (Number(revenue._sum.totalAmount) || 0) / totalOrders : 0,
    };
  }
}

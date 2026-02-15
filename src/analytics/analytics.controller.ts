import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('orders')
  async orderStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        ordersByStatus: {
          PENDING: 0,
          PROCESSING: 0,
          SHIPPED: 0,
          DELIVERED: 0,
          CANCELLED: 0,
        },
      };
    }
    return this.analyticsService.getOrderStats(tenantId);
  }

  @Get('traffic')
  async trafficStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return {
        totalVisits: 0,
        uniqueVisitors: 0,
        pageViews: 0,
        bounceRate: 0,
        averageSessionDuration: 0,
      };
    }
    return this.analyticsService.getTrafficStats(tenantId);
  }

  @Get('products')
  async productStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { totalProducts: 0, lowStockProducts: 0 };
    }
    return this.analyticsService.getProductStats(tenantId);
  }

  @Get('customers')
  async customerStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { totalCustomers: 0, newCustomers: 0 };
    }
    return this.analyticsService.getCustomerStats(tenantId);
  }

  @Get('revenue')
  async revenueStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0 };
    }
    return this.analyticsService.getRevenueStats(tenantId);
  }

  @Get('dashboard')
  async dashboardStats(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        ordersByStatus: {},
      };
    }
    return this.analyticsService.getDashboardStats(tenantId);
  }
}

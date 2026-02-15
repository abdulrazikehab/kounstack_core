import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportService } from './report.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('overview')
  async overview(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { totalOrders: 0, revenue: 0, totalTransactions: 0, activityCount: 0 };
    }
    return this.reports.overview(tenantId);
  }

  @Get('products')
  async getProductReport(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('search') search?: string,
  ) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    }
    return this.reports.getProductReport(
      tenantId,
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
      search,
    );
  }

  @Get('customers')
  async getCustomerReport(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return [];
    }
    return this.reports.getCustomerReport(tenantId);
  }

  @Get('payments')
  async getPaymentReport(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return [];
    }
    return this.reports.getPaymentReport(tenantId);
  }

  @Get('sales')
  async getSalesReport(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return {
        totalSales: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        byDate: [],
      };
    }
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.reports.getSalesReport(tenantId, start, end);
  }

  @Get('balances')
  async getCustomerBalancesReport(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return { wallets: [], totalBalance: 0 };
    }
    return this.reports.getCustomerBalancesReport(tenantId);
  }
}

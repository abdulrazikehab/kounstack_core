import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MerchantReportService } from '../services/merchant-report.service';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { ReportDateRangeQuery } from '../dto';

@Controller('merchant/dashboard')
@UseGuards(JwtAuthGuard)
export class MerchantDashboardController {
  constructor(
    private readonly reportService: MerchantReportService,
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get('home')
  async getHome(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.reportService.getDashboardHome(context.merchantId, userId);
  }

  @Get('reports/profit')
  async getProfitReport(
    @Request() req: any,
    @Query() query: ReportDateRangeQuery,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'reportsRead');

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.REPORT_VIEWED,
      'Report',
      'profit',
      { range: query.range, from: query.from, to: query.to },
    );

    return this.reportService.getProfitReport(context.merchantId, query);
  }

  @Get('reports/top-profitable-products')
  async getTopProfitableProducts(
    @Request() req: any,
    @Query() query: ReportDateRangeQuery & { limit?: string },
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'reportsRead');

    return this.reportService.getTopProfitableProducts(context.merchantId, {
      ...query,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  @Get('reports/top-selling-products')
  async getTopSellingProducts(
    @Request() req: any,
    @Query() query: ReportDateRangeQuery & { limit?: string },
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'reportsRead');

    return this.reportService.getTopSellingProducts(context.merchantId, {
      ...query,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  @Get('reports/price-changes')
  async getPriceChangesReport(
    @Request() req: any,
    @Query('productId') productId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'reportsRead');

    return this.reportService.getPriceChangesReport(context.merchantId, {
      productId,
      from,
      to,
    });
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    // Only owner can view all logs, employees can only view their own
    const filterActorUserId = context.isOwner ? actorUserId : userId;

    return this.auditService.findAll(context.merchantId, {
      from,
      to,
      actorUserId: filterActorUserId,
      action,
      cursor,
      limit: limit ? parseInt(limit) : undefined,
    });
  }
}


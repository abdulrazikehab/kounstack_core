import { Controller, Get, Post, Query, Param, ParseIntPipe, DefaultValuePipe, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { TransactionStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  // Get tenant balance summary
  @Get('balance')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getBalance(@Request() req: any, @Query('tenantId') tenantId: string) {
    // Security: Ensure user only accesses their own tenant data
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');
    
    return this.transactionService.getTenantBalance(targetTenantId);
  }

  // Get list of transactions with optional filters
  @Get()
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getTransactions(
    @Request() req: any,
    @Query('tenantId') tenantId: string,
    @Query('status') status?: TransactionStatus,
    @Query('customerEmail') customerEmail?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.getTransactions(targetTenantId, {
      status,
      customerEmail,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit,
      offset,
    });
  }

  // Get single transaction details
  @Get(':id')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getTransaction(@Request() req: any, @Param('id') id: string, @Query('tenantId') tenantId: string) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.getTransactionById(targetTenantId, id);
  }

  // Get transaction statistics (for charts)
  @Get('stats')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getStats(
    @Request() req: any,
    @Query('tenantId') tenantId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.getTransactionStats(
      targetTenantId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  // Get subscription info
  @Get('subscription')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getSubscription(@Request() req: any, @Query('tenantId') tenantId: string) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.getSubscriptionInfo(targetTenantId);
  }

  // Reprint transaction receipt and increment print count
  @Post(':id/reprint')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async reprintTransaction(
    @Request() req: any,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
  ) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.reprintTransaction(targetTenantId, id);
  }

  // Refund a transaction
  @Post(':id/refund')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async refundTransaction(
    @Request() req: any,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
  ) {
    const userTenantId = req.user.tenantId;
    const targetTenantId = (req.user.role === UserRole.SUPER_ADMIN && tenantId) ? tenantId : userTenantId;
    
    if (!targetTenantId) throw new ForbiddenException('Tenant context required');

    return this.transactionService.refundTransaction(targetTenantId, id);
  }
}

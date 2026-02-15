import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Headers,
  Ip,
  BadRequestException,
} from '@nestjs/common';
import { MerchantOrderService } from '../services/merchant-order.service';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import {
  CreateOrderFromCartDto,
  CreateQuickRechargeOrderDto,
  ReorderDto,
  CancelOrderDto,
  SubmitBankTransferProofDto,
  OrderListQuery,
} from '../dto';

@Controller('merchant/orders')
@UseGuards(JwtAuthGuard)
export class MerchantOrderController {
  constructor(
    private readonly orderService: MerchantOrderService,
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: OrderListQuery,
  ) {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        throw new BadRequestException('User authentication required');
      }
      const context = await this.merchantService.validateMerchantAccess(userId, 'ordersRead');
      return await this.orderService.getOrders(context.merchantId, query);
    } catch (error) {
      return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 }; // Return empty structure if merchant access fails
    }
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() dto: CreateOrderFromCartDto | CreateQuickRechargeOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersCreate');

    let order;
    if (dto.source === 'cart') {
      order = await this.orderService.createFromCart(
        context.merchantId,
        context.tenantId,
        userId,
        dto as CreateOrderFromCartDto,
        context.employeeId,
        idempotencyKey,
        ipAddress,
        userAgent,
      );
    } else {
      // Quick recharge order - would need separate implementation
      throw new Error('Quick recharge not yet implemented');
    }

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.ORDER_CREATED,
      'MerchantOrder',
      order.id,
      { orderNumber: order.orderNumber, total: order.total },
      ipAddress,
      userAgent,
    );

    return order;
  }

  @Get(':id')
  async findOne(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersRead');

    return await this.orderService.getOrder(context.merchantId, id);
  }

  @Post(':id/cancel')
  async cancel(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersCreate');

    const result = await this.orderService.cancelOrder(context.merchantId, userId, id, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.ORDER_CANCELLED,
      'MerchantOrder',
      id,
      { reason: dto.reason },
    );

    return result;
  }

  @Post(':id/reorder')
  async reorder(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersCreate');

    const order = await this.orderService.reorder(
      context.merchantId,
      context.tenantId,
      userId,
      id,
      dto,
      context.employeeId,
    );

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.ORDER_REORDERED,
      'MerchantOrder',
      order.id,
      { originalOrderId: id, orderNumber: order.orderNumber },
    );

    return order;
  }

  @Post(':id/submit-bank-transfer-proof')
  async submitBankTransferProof(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitBankTransferProofDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersCreate');

    return await this.orderService.submitBankTransferProof(context.merchantId, id, dto);
  }
}


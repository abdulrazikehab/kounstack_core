import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CardOrderService, CreateOrderDto } from './card-order.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';

@Controller('card-orders')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class CardOrderController {
  constructor(private readonly cardOrderService: CardOrderService) {}

  @Post()
  async createOrder(@Request() req: any, @Body() body: CreateOrderDto) {
    return this.cardOrderService.createOrder(
      req.tenantId,
      req.user.id || req.user.userId,
      body,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('my-orders')
  async getMyOrders(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
  ) {
    return this.cardOrderService.getUserOrders(
      req.tenantId,
      req.user.id || req.user.userId,
      parseInt(page),
      parseInt(limit),
      status,
    );
  }

  @Get(':id')
  async getOrder(@Request() req: any, @Param('id') id: string) {
    return this.cardOrderService.getOrder(req.tenantId, req.user.id || req.user.userId, id);
  }

  @Get(':id/download-files')
  async downloadFiles(@Request() req: any, @Param('id') id: string) {
    return this.cardOrderService.generateOrderFiles(
      req.tenantId,
      req.user.id || req.user.userId,
      id,
    );
  }

  @Post(':id/cancel')
  async cancelOrder(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.cardOrderService.cancelOrder(
      req.tenantId,
      req.user.id || req.user.userId,
      id,
      body.reason,
    );
  }

  // Admin endpoints
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Get('admin/all')
  async getAllOrders(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cardOrderService.getAllOrders(
      req.tenantId,
      parseInt(page),
      parseInt(limit),
      status,
      userId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Get('admin/stats')
  async getOrderStats(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cardOrderService.getOrderStats(
      req.tenantId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }
}

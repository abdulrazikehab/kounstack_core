import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MerchantNotificationService } from '../services/merchant-notification.service';
import { MerchantService } from '../services/merchant.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { NotificationListQuery } from '../dto';

@Controller('merchant/notifications')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MerchantNotificationController {
  constructor(
    private readonly notificationService: MerchantNotificationService,
    private readonly merchantService: MerchantService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: NotificationListQuery,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.notificationService.findAll(context.merchantId, query);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.notificationService.getUnreadCount(context.merchantId);
  }

  @Post(':id/read')
  async markAsRead(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.notificationService.markAsRead(context.merchantId, id);
  }

  @Post('read-all')
  async markAllAsRead(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.notificationService.markAllAsRead(context.merchantId);
  }
}


import { Controller, Get, Put, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId || 'default';
      const userId = req.user?.id;
      return await this.notificationsService.findAll(tenantId, userId);
    } catch (error: any) {
      console.error('Error in notifications controller:', error);
      return [];
    }
  }

  @Put(':id/read')
  async markAsRead(@Param('id') id: string) {
    return await this.notificationsService.markAsRead(id);
  }

  @Put('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    const userId = req.user?.id;
    if (!userId) return { count: 0 };
    return this.notificationsService.markAllAsRead(tenantId, userId);
  }

  @Get('settings')
  async getSettings(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    return this.notificationsService.getSettings(tenantId);
  }

  @Put('settings')
  async updateSettings(@Request() req: AuthenticatedRequest, @Body() settings: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    return this.notificationsService.updateSettings(tenantId, settings);
  }

  @Post('send')
  async sendNotification(@Body() data: {
    tenantId: string;
    userId?: string;
    type: 'ORDER' | 'CUSTOMER' | 'INVENTORY' | 'MARKETING';
    titleEn: string;
    titleAr?: string;
    bodyEn: string;
    bodyAr?: string;
    data?: any;
  }) {
    return this.notificationsService.sendNotification(data);
  }

  @Public()
  @Post('sms')
  async sendSMS(@Body() data: {
    tenantId: string;
    to: string;
    message: string;
    messageAr?: string;
  }) {
    return this.notificationsService.sendSMS({
      tenantId: data.tenantId,
      to: data.to,
      message: data.messageAr || data.message
    });
  }
}


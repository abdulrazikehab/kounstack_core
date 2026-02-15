import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationListQuery } from '../dto';

@Injectable()
export class MerchantNotificationService {
  private readonly logger = new Logger(MerchantNotificationService.name);

  constructor(private prisma: PrismaService) {}

  // Get notifications for merchant
  async findAll(merchantId: string, query: NotificationListQuery) {
    const limit = query.limit || 20;
    const where: any = { merchantId };

    if (query.unreadOnly) {
      where.readAt = null;
    }

    const cursorOptions: any = {};
    if (query.cursor) {
      cursorOptions.cursor = { id: query.cursor };
      cursorOptions.skip = 1;
    }

    const notifications = await this.prisma.merchantNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...cursorOptions,
    });

    const hasMore = notifications.length > limit;
    const items = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((n: any) => ({
        id: n.id,
        type: n.type,
        titleEn: n.titleEn,
        titleAr: n.titleAr,
        bodyEn: n.bodyEn,
        bodyAr: n.bodyAr,
        data: n.data,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      nextCursor,
    };
  }

  // Get unread count
  async getUnreadCount(merchantId: string) {
    const count = await this.prisma.merchantNotification.count({
      where: { merchantId, readAt: null },
    });

    return { count };
  }

  // Mark notification as read
  async markAsRead(merchantId: string, notificationId: string) {
    const notification = await this.prisma.merchantNotification.findFirst({
      where: { id: notificationId, merchantId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.merchantNotification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return { ok: true, readAt: new Date() };
  }

  // Mark all as read
  async markAllAsRead(merchantId: string) {
    await this.prisma.merchantNotification.updateMany({
      where: { merchantId, readAt: null },
      data: { readAt: new Date() },
    });

    return { ok: true };
  }

  // Create notification
  async create(
    merchantId: string,
    type: 'ORDER_STATUS' | 'PRICE_ALERT' | 'PROMOTION' | 'LOW_WALLET' | 'SUPPORT_UPDATE' | 'SYSTEM',
    titleEn: string,
    bodyEn: string,
    titleAr?: string,
    bodyAr?: string,
    data?: any,
  ) {
    const notification = await this.prisma.merchantNotification.create({
      data: {
        merchantId,
        type,
        titleEn,
        titleAr,
        bodyEn,
        bodyAr,
        data,
      },
    });

    this.logger.log(`Created notification ${notification.id} for merchant ${merchantId}`);

    return notification;
  }

  // Create order status notification
  async notifyOrderStatus(merchantId: string, orderNumber: string, status: string, orderId: string) {
    const statusMessages: Record<string, { en: string; ar: string }> = {
      PROCESSING: { en: 'is now processing', ar: 'قيد المعالجة' },
      COMPLETED: { en: 'has been completed', ar: 'تم إكماله' },
      FAILED: { en: 'has failed', ar: 'فشل' },
      CANCELLED: { en: 'has been cancelled', ar: 'تم إلغاؤه' },
    };

    const message = statusMessages[status] || { en: `status changed to ${status}`, ar: `تغيرت الحالة إلى ${status}` };

    await this.create(
      merchantId,
      'ORDER_STATUS',
      `Order ${orderNumber} ${message.en}`,
      `Your order ${orderNumber} ${message.en}`,
      `الطلب ${orderNumber} ${message.ar}`,
      `طلبك ${orderNumber} ${message.ar}`,
      { orderId, orderNumber, status },
    );
  }

  // Create low wallet notification
  async notifyLowWallet(merchantId: string, balance: number, threshold: number, currency: string) {
    // Check if already notified recently
    const recent = await this.prisma.merchantNotification.findFirst({
      where: {
        merchantId,
        type: 'LOW_WALLET',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24 hours
      },
    });

    if (recent) return; // Don't spam

    await this.create(
      merchantId,
      'LOW_WALLET',
      'Low Wallet Balance',
      `Your wallet balance (${balance} ${currency}) is below the threshold (${threshold} ${currency})`,
      'رصيد المحفظة منخفض',
      `رصيد محفظتك (${balance} ${currency}) أقل من الحد الأدنى (${threshold} ${currency})`,
      { balance, threshold, currency },
    );
  }

  // Create promotion notification
  async notifyPromotion(merchantId: string, promotionId: string, title: string, titleAr?: string) {
    await this.create(
      merchantId,
      'PROMOTION',
      `New Promotion: ${title}`,
      `Check out the new promotion available for you!`,
      titleAr ? `عرض جديد: ${titleAr}` : undefined,
      'اطلع على العرض الجديد المتاح لك!',
      { promotionId },
    );
  }
}


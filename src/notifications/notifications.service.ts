import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { NotificationsGateway } from './notifications.gateway';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    });

    const settings = (tenant?.settings as any)?.notifications || {
      emailNotifications: true,
      orderNotifications: true,
      customerNotifications: true,
      inventoryNotifications: true,
      marketingNotifications: false,
      pushNotifications: false,
    };

    return settings;
  }

  async updateSettings(tenantId: string, settings: any) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    });

    const currentSettings = (tenant?.settings as any) || {};
    const newSettings = {
      ...currentSettings,
      notifications: {
        ...(currentSettings.notifications || {}),
        ...settings
      }
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: newSettings }
    });

    return newSettings.notifications;
  }

  async findAll(tenantId: string, userId?: string) {
    try {
      if (!userId) return [];
      
      return await this.prisma.notification.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      return [];
    }
  }

  async create(data: {
    tenantId: string;
    userId: string;
    type: string;
    titleEn: string;
    titleAr?: string;
    bodyEn: string;
    bodyAr?: string;
    data?: any;
  }) {
    const notification = await this.prisma.notification.create({
      data,
    });

    // Send real-time notification
    this.notificationsGateway.sendToUser(data.userId, 'notification', notification);

    return notification;
  }

  async sendNotification(params: {
    tenantId: string;
    userId?: string; // Target user (e.g. merchant admin or customer)
    targetEmail?: string; // Optional direct email (e.g. for guests)
    type: 'ORDER' | 'CUSTOMER' | 'INVENTORY' | 'MARKETING';
    titleEn: string;
    titleAr?: string;
    bodyEn: string;
    bodyAr?: string;
    data?: any;
  }) {
    const { tenantId, type, titleEn, titleAr, bodyEn, bodyAr, data, targetEmail } = params;

    // 1. Get tenant settings
    const settings = await this.getSettings(tenantId);

    // 2. Check if this type of notification is enabled
    const isEnabled = 
      (type === 'ORDER' && settings.orderNotifications) ||
      (type === 'CUSTOMER' && settings.customerNotifications) ||
      (type === 'INVENTORY' && settings.inventoryNotifications) ||
      (type === 'MARKETING' && settings.marketingNotifications);

    if (!isEnabled) {
      this.logger.log(`Notification type ${type} is disabled for tenant ${tenantId}`);
      return;
    }

    // 3. Find target users (merchant admins/staff) if userId not provided
    let targetUserIds: string[] = [];
    if (params.userId) {
      targetUserIds = [params.userId];
    } else {
      const staff = await this.prisma.user.findMany({
        where: { 
          tenantId,
          role: { in: ['SHOP_OWNER', 'STAFF'] }
        },
        select: { id: true }
      });
      targetUserIds = staff.map(u => u.id);
    }

    // 4. Create in-app notifications and send real-time
    for (const userId of targetUserIds) {
      await this.create({
        tenantId,
        userId,
        type,
        titleEn,
        titleAr,
        bodyEn,
        bodyAr,
        data
      });
    }

    // 5. Send email if enabled
    if (settings.emailNotifications) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true }
      });

      // Determine recipient email
      let recipientEmail: string | null = targetEmail || null;

      if (!recipientEmail && params.userId) {
        // If a specific user is targeted, send to them (e.g. Customer)
        const user = await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { email: true }
        });
        recipientEmail = user?.email || null;
      } 
      
      // If no specific user or user has no email, and it's NOT a customer notification (system/order alert), send to owner
      if (!recipientEmail && type !== 'CUSTOMER') {
        const owner = await this.prisma.user.findFirst({
          where: { 
            tenantId,
            role: 'SHOP_OWNER'
          },
          select: { email: true }
        });
        recipientEmail = owner?.email || null;
      }

      if (recipientEmail) {
        await this.sendEmailDirect({
          to: recipientEmail,
          subject: titleAr || titleEn,
          tenantId: tenantId,
          fromName: tenant?.name,
          body: bodyAr || bodyEn
        });
      }
    }
  }

  /**
   * Send email directly via Auth API
   */
  async sendEmailDirect(params: {
    to: string;
    subject: string;
    body: string;
    tenantId: string;
    fromName?: string;
  }) {
    const authServiceUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    try {
      await firstValueFrom(
        this.httpService.post(`${authServiceUrl}/email/send`, {
          to: params.to,
          subject: params.subject,
          tenantId: params.tenantId,
          fromName: params.fromName,
          html: `
            <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>${params.subject}</h2>
              <p>${params.body}</p>
              <hr>
              <p style="font-size: 12px; color: #666;">تم إرسال هذا البريد الإلكتروني تلقائياً من ${params.fromName || 'منصة سعة'}.</p>
            </div>
          `
        })
      );
      this.logger.log(`Email notification sent to ${params.to}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send email notification to ${params.to}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send WhatsApp notification (Placeholder/Implementation)
   */
  async sendWhatsApp(params: {
    to: string;
    message: string;
    tenantId: string;
  }) {
    this.logger.log(`[WhatsApp Mock] Sending message to ${params.to}: ${params.message}`);
    // In production, integrate with UltraMsg, Twilio, or similar
    return true;
  }

  /**
   * Send SMS notification
   */
  async sendSMS(params: {
    to: string;
    message: string;
    tenantId: string;
  }) {
    const provider = process.env.SMS_PROVIDER || 'mock';
    const username = process.env.SMS_USERNAME;
    const apiKey = process.env.SMS_API_KEY;
    const sender = process.env.SMS_SENDER;

    this.logger.log(`Attempting to send SMS via ${provider} to ${params.to}`);

    if (provider === 'msegat' && username && apiKey && sender) {
      try {
        // Clean phone number: remove + and ensure it starts with country code
        const cleanNumber = params.to.replace(/\+/g, '').trim();
        
        const payload = {
          userName: username,
          apiKey: apiKey,
          numbers: cleanNumber,
          userSender: sender,
          msg: params.message,
          msgEncoding: 'UTF8'
        };

        this.logger.log(`Sending Msegat request to ${cleanNumber}`);
        const response = await firstValueFrom(
          this.httpService.post('https://www.msegat.com/gw/sendsms.php', payload)
        );

        // Msegat returns "1" on success
        if (response.data && (response.data === '1' || response.data.code === '1' || String(response.data).includes('Success'))) {
          this.logger.log(`✅ SMS sent successfully via Msegat to ${params.to}`);
          return true;
        } else {
          this.logger.error(`❌ Msegat SMS failed: ${JSON.stringify(response.data)}`);
          return false;
        }
      } catch (error: any) {
        this.logger.error(`❌ Msegat API error: ${error.message}`);
        return false;
      }
    }

    // Fallback/Mock behavior
    this.logger.log(`[SMS Mock] Sending SMS to ${params.to}: ${params.message}`);
    if (provider !== 'mock') {
        this.logger.warn(`⚠️ SMS Provider ${provider} is not fully configured. Missing credentials?`);
    }
    return true;
  }

  async markAsRead(id: string) {
    return await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}


import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MerchantAuditService {
  private readonly logger = new Logger(MerchantAuditService.name);

  constructor(private prisma: PrismaService) {}

  // Log action
  async log(
    merchantId: string,
    actorUserId: string | null,
    actorEmployeeId: string | null,
    actorType: 'MERCHANT' | 'EMPLOYEE' | 'ADMIN' | 'SYSTEM',
    action: string,
    entityType?: string,
    entityId?: string,
    metadata?: any,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const log = await this.prisma.merchantAuditLog.create({
      data: {
        merchantId,
        actorUserId,
        actorEmployeeId,
        actorType,
        action,
        entityType,
        entityId,
        metadata,
        ipAddress,
        userAgent,
      },
    });

    this.logger.debug(`Audit: ${action} by ${actorType} ${actorUserId || actorEmployeeId}`);

    return log;
  }

  // Get audit logs for merchant
  async findAll(
    merchantId: string,
    query: {
      from?: string;
      to?: string;
      actorUserId?: string;
      action?: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    const limit = query.limit || 50;
    const where: any = { merchantId };

    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
    }

    if (query.action) {
      where.action = { contains: query.action };
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const cursorOptions: any = {};
    if (query.cursor) {
      cursorOptions.cursor = { id: query.cursor };
      cursorOptions.skip = 1;
    }

    const logs = await this.prisma.merchantAuditLog.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...cursorOptions,
    });

    const hasMore = logs.length > limit;
    const items = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((log) => ({
        id: log.id,
        actorType: log.actorType,
        actorUserId: log.actorUserId,
        actorEmployeeId: log.actorEmployeeId,
        employeeName: log.employee?.name,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      })),
      nextCursor,
    };
  }

  // Common action constants
  static readonly Actions = {
    // Auth
    LOGIN: 'auth.login',
    LOGOUT: 'auth.logout',
    PASSWORD_CHANGED: 'auth.password_changed',

    // Employee
    EMPLOYEE_CREATED: 'employee.created',
    EMPLOYEE_UPDATED: 'employee.updated',
    EMPLOYEE_DISABLED: 'employee.disabled',

    // Player
    PLAYER_CREATED: 'player.created',
    PLAYER_UPDATED: 'player.updated',
    PLAYER_DELETED: 'player.deleted',

    // Order
    ORDER_CREATED: 'order.created',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_REORDERED: 'order.reordered',
    ORDER_PURCHASE: 'order.purchase',
    REVEAL_CODES: 'order.reveal_codes',

    // Cart
    CART_ITEM_ADDED: 'cart.item_added',
    CART_CLEARED: 'cart.cleared',

    // Report
    REPORT_VIEWED: 'report.viewed',

    // Settings
    SETTINGS_UPDATED: 'settings.updated',
    PROFILE_UPDATED: 'profile.updated',
  };
}


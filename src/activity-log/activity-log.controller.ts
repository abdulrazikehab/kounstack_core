import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityLogService } from './activity-log.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('activity-log')
@UseGuards(JwtAuthGuard)
export class ActivityLogController {
  constructor(
    private readonly logs: ActivityLogService,
    private readonly prisma: PrismaService
  ) {}

@Get()
  async list(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityType') entityType?: string,
  ) {
    const tenantId = req.user?.tenantId || req.user?.id || req.tenantId;
    if (!tenantId) {
      return {
        logs: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const skip = (page - 1) * limit;
    const where: any = { tenantId };

    if (userId) {
      where.actorId = userId;
    }

    const andConditions: any[] = [];

    if (action && action !== 'all') {
      andConditions.push({ action: { contains: action, mode: 'insensitive' } });
    }

    if (entityType && entityType !== 'all') {
      andConditions.push({ action: { startsWith: entityType, mode: 'insensitive' } });
    }

    if (search) {
      andConditions.push({ action: { contains: search, mode: 'insensitive' } });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        // adjust to end of day if only date string provided
        const end = new Date(endDate);
        if (endDate.length <= 10) { // YYYY-MM-DD
           end.setHours(23, 59, 59, 999);
        }
        where.createdAt.lte = end;
      }
    }

    const logs = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const actorIds = [...new Set(logs.map((l: any) => l.actorId).filter(Boolean))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, email: true, role: true },
    });
    
    const actorMap = new Map(actors.map((u) => [u.id, u]));

    const total = await this.prisma.activityLog.count({ where });

    const formattedLogs = logs.map((log: any) => {
      const actor: any = actorMap.get(log.actorId);
      return {
        id: log.id,
        action: log.action,
        userId: log.actorId,
        metadata: typeof log.details === 'string' ? JSON.parse(log.details || '{}') : log.details || {},
        createdAt: log.createdAt,
        entityType: log.action ? log.action.split('.')[0] : 'unknown',
        entityId: log.targetId,
        actor: actor ? {
          id: actor.id,
          email: actor.email,
          name: actor.name,
          role: actor.role,
        } : { id: log.actorId, name: 'Unknown', email: '', role: 'N/A' },
        actorName: actor?.name || 'Unknown',
        actorEmail: actor?.email || '',
        actorRole: actor?.role || 'N/A',
      };
    });

    return {
      logs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

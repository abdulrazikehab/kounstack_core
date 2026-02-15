import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityLogCreateDto {
  tenantId: string;
  actorId: string;
  targetId?: string;
  action: string;
  details?: any;
}

@Injectable()
export class ActivityLogService {
  constructor(private prisma: PrismaService) {}

  async create(dto: ActivityLogCreateDto) {
    return this.prisma.activityLog.create({
      data: {
        tenantId: dto.tenantId,
        actorId: dto.actorId,
        targetId: dto.targetId,
        action: dto.action,
        details: dto.details ? JSON.stringify(dto.details) : undefined,
      },
    });
  }

  async findMany(tenantId: string, skip = 0, take = 20) {
    return this.prisma.activityLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }
}

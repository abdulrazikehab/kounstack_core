import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class MerchantSessionService {
  private readonly logger = new Logger(MerchantSessionService.name);

  constructor(private prisma: PrismaService) {}

  // Create session
  async create(
    merchantId: string,
    userId: string,
    employeeId?: string,
    device?: { deviceId?: string; deviceName?: string; platform?: string },
    ipAddress?: string,
    userAgent?: string,
  ) {
    const session = await this.prisma.merchantSession.create({
      data: {
        merchantId,
        userId,
        employeeId,
        deviceId: device?.deviceId,
        deviceName: device?.deviceName,
        platform: device?.platform,
        ipAddress,
        userAgent,
        isTrusted: false,
      },
    });

    this.logger.log(`Created session ${session.id} for merchant ${merchantId}`);

    return session;
  }

  // Get active sessions for merchant
  async findAll(merchantId: string) {
    const sessions = await this.prisma.merchantSession.findMany({
      where: { merchantId, revokedAt: null },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        platform: true,
        ipAddress: true,
        isTrusted: true,
        createdAt: true,
        lastSeenAt: true,
        employee: { select: { id: true, name: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((s: any) => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      platform: s.platform,
      ipAddress: s.ipAddress,
      isTrusted: s.isTrusted,
      employeeName: s.employee?.name,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    }));
  }

  // Update session last seen
  async updateLastSeen(sessionId: string) {
    await this.prisma.merchantSession.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  // Trust/untrust session
  async setTrust(merchantId: string, sessionId: string, isTrusted: boolean) {
    const session = await this.prisma.merchantSession.findFirst({
      where: { id: sessionId, merchantId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.merchantSession.update({
      where: { id: sessionId },
      data: { isTrusted },
    });

    return { ok: true, isTrusted };
  }

  // Revoke session
  async revoke(merchantId: string, sessionId: string) {
    const session = await this.prisma.merchantSession.findFirst({
      where: { id: sessionId, merchantId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.merchantSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Revoked session ${sessionId}`);

    return { ok: true };
  }

  // Revoke all sessions except current
  async revokeAllExcept(merchantId: string, currentSessionId: string) {
    await this.prisma.merchantSession.updateMany({
      where: {
        merchantId,
        id: { not: currentSessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Revoked all sessions for merchant ${merchantId} except ${currentSessionId}`);

    return { ok: true };
  }

  // Check if session is valid
  async isValid(sessionId: string): Promise<boolean> {
    const session = await this.prisma.merchantSession.findUnique({
      where: { id: sessionId },
    });

    return session !== null && session.revokedAt === null;
  }
}


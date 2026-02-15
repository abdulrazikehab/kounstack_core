import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(private prisma: PrismaService) {}

  async checkTransactionRisk(tenantId: string, userId: string | null, amount: number, ip: string): Promise<{ isRisky: boolean; reason?: string; riskScore: number }> {
    let riskScore = 0;
    const reasons: string[] = [];

    // 1. Velocity Check: Too many orders in short time?
    if (userId || ip) {
      const recentOrders = await this.prisma.order.count({
        where: {
          tenantId,
          OR: [
            { customerEmail: userId || undefined },
            { ipAddress: ip },
          ],
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // Last 1 hour
          },
        },
      });

      if (recentOrders > 5) {
        riskScore += 50;
        reasons.push('High velocity: Too many orders in 1 hour');
      } else if (recentOrders > 2) {
        riskScore += 20;
      }
    }

    // 2. Amount Check: Unusually high amount?
    const MAX_SAFE_AMOUNT = 10000; 
    if (amount > MAX_SAFE_AMOUNT) {
       riskScore += 40;
       reasons.push('High value: Amount exceeds automatic safety limit');
    }

    // 3. IP History Check: Failed payments
    if (ip) {
      const failedOrders = await this.prisma.order.count({
        where: {
          tenantId,
          ipAddress: ip,
          paymentStatus: 'FAILED',
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      });

      if (failedOrders > 3) {
        riskScore += 60;
        reasons.push('Suspicious History: Multiple failed payments from this IP');
      }
    }

    // 4. VPN/Proxy Check (Placeholder)
    // if (this.isVpn(ip)) { riskScore += 30; reasons.push('VPN/Proxy detected'); }

    const isRisky = riskScore > 80;

    return { 
      isRisky, 
      reason: reasons.join('; '),
      riskScore 
    };
  }
}

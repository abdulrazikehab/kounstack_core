import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionListQuery } from '../dto';

@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(private prisma: PrismaService) {}

  // Get promotions for merchant
  async findAll(tenantId: string, merchantId: string, query: PromotionListQuery) {
    const now = new Date();
    let where: any = { tenantId };

    switch (query.status) {
      case 'active':
        where.status = 'ACTIVE';
        where.startAt = { lte: now };
        where.endAt = { gte: now };
        break;
      case 'upcoming':
        where.status = { in: ['ACTIVE', 'SCHEDULED'] };
        where.startAt = { gt: now };
        break;
      case 'expired':
        where.endAt = { lt: now };
        break;
      default:
        // All non-draft promotions
        where.status = { not: 'DRAFT' };
    }

    const promotions = await this.prisma.promotion.findMany({
      where,
      orderBy: { startAt: 'desc' },
    });

    // Get progress for merchant
    const progressRecords = await this.prisma.merchantPromotionProgress.findMany({
      where: {
        merchantId,
        promotionId: { in: promotions.map((p: any) => p.id) },
      },
    });

    const progressMap = new Map(progressRecords.map((p: any) => [p.promotionId, p]));

    return promotions.map((p: any) => {
      const progress = progressMap.get(p.id) as { progress?: any; isCompleted?: boolean; completedAt?: Date; rewardClaimed?: boolean } | undefined;
      return {
        id: p.id,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        descriptionEn: p.descriptionEn,
        descriptionAr: p.descriptionAr,
        type: p.type,
        status: p.status,
        startAt: p.startAt,
        endAt: p.endAt,
        imageUrl: p.imageUrl,
        conditions: p.conditions,
        benefit: p.benefit,
        progress: progress ? {
          promotionId: p.id,
          progress: progress.progress,
          isCompleted: progress.isCompleted,
          completedAt: progress.completedAt,
          rewardClaimed: progress.rewardClaimed,
        } : null,
      };
    });
  }

  // Get single promotion with progress
  async findOne(tenantId: string, merchantId: string, promotionId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: promotionId, tenantId },
    });

    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }

    // Get or create progress
    let progress = await this.prisma.merchantPromotionProgress.findUnique({
      where: { merchantId_promotionId: { merchantId, promotionId } },
    });

    if (!progress) {
      progress = await this.prisma.merchantPromotionProgress.create({
        data: {
          merchantId,
          promotionId,
          progress: {},
          isCompleted: false,
        },
      });
    }

    // Calculate progress details
    const conditions = promotion.conditions as any;
    const progressData = progress.progress as any;
    const benefit = promotion.benefit as any;

    let currentValue = 0;
    let targetValue = 0;
    let percentage = 0;
    let estimatedReward = 0;

    if (conditions.minOrders) {
      targetValue = conditions.minOrders;
      currentValue = progressData.ordersCount || 0;
      percentage = Math.min(100, (currentValue / targetValue) * 100);
    } else if (conditions.minVolume) {
      targetValue = conditions.minVolume;
      currentValue = progressData.volume || 0;
      percentage = Math.min(100, (currentValue / targetValue) * 100);
    }

    if (benefit.type === 'cashback_fixed') {
      estimatedReward = benefit.value;
    } else if (benefit.type === 'cashback_percent') {
      estimatedReward = (currentValue * benefit.value) / 100;
      if (benefit.maxDiscount && estimatedReward > benefit.maxDiscount) {
        estimatedReward = benefit.maxDiscount;
      }
    }

    return {
      id: promotion.id,
      titleEn: promotion.titleEn,
      titleAr: promotion.titleAr,
      descriptionEn: promotion.descriptionEn,
      descriptionAr: promotion.descriptionAr,
      type: promotion.type,
      status: promotion.status,
      startAt: promotion.startAt,
      endAt: promotion.endAt,
      imageUrl: promotion.imageUrl,
      conditions: promotion.conditions,
      benefit: promotion.benefit,
      progress: {
        promotionId,
        progress: {
          ordersCount: progressData.ordersCount,
          volume: progressData.volume,
          currentValue,
          targetValue,
          percentage,
        },
        isCompleted: progress.isCompleted,
        completedAt: progress.completedAt,
        estimatedReward,
        rewardClaimed: progress.rewardClaimed,
      },
    };
  }

  // Get promotion progress only
  async getProgress(merchantId: string, promotionId: string) {
    const progress = await this.prisma.merchantPromotionProgress.findUnique({
      where: { merchantId_promotionId: { merchantId, promotionId } },
      include: { promotion: true },
    });

    if (!progress) {
      throw new NotFoundException('Promotion progress not found');
    }

    const conditions = progress.promotion.conditions as any;
    const progressData = progress.progress as any;
    const benefit = progress.promotion.benefit as any;

    let currentValue = 0;
    let targetValue = 0;
    let percentage = 0;
    let estimatedReward = 0;

    if (conditions.minOrders) {
      targetValue = conditions.minOrders;
      currentValue = progressData.ordersCount || 0;
      percentage = Math.min(100, (currentValue / targetValue) * 100);
    } else if (conditions.minVolume) {
      targetValue = conditions.minVolume;
      currentValue = progressData.volume || 0;
      percentage = Math.min(100, (currentValue / targetValue) * 100);
    }

    if (benefit.type === 'cashback_fixed') {
      estimatedReward = benefit.value;
    } else if (benefit.type === 'cashback_percent') {
      estimatedReward = (currentValue * benefit.value) / 100;
      if (benefit.maxDiscount && estimatedReward > benefit.maxDiscount) {
        estimatedReward = benefit.maxDiscount;
      }
    }

    return {
      promotionId,
      progress: {
        ordersCount: progressData.ordersCount,
        volume: progressData.volume,
        currentValue,
        targetValue,
        percentage,
      },
      isCompleted: progress.isCompleted,
      completedAt: progress.completedAt,
      estimatedReward,
      rewardClaimed: progress.rewardClaimed,
    };
  }

  // Update promotion progress (called after order completion)
  async updateProgressOnOrder(merchantId: string, orderTotal: number, productIds: string[]) {
    const now = new Date();

    // Get all active promotions
    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { lte: now },
        endAt: { gte: now },
      },
    });

    for (const promotion of promotions) {
      const conditions = promotion.conditions as any;

      // Check if order qualifies (product restriction)
      if (conditions.productIds && conditions.productIds.length > 0) {
        const hasMatchingProduct = productIds.some((id) =>
          conditions.productIds.includes(id)
        );
        if (!hasMatchingProduct) continue;
      }

      // Update or create progress
      const existing = await this.prisma.merchantPromotionProgress.findUnique({
        where: { merchantId_promotionId: { merchantId, promotionId: promotion.id } },
      });

      if (existing && existing.isCompleted) continue;

      const currentProgress = (existing?.progress as any) || { ordersCount: 0, volume: 0 };
      const newProgress = {
        ordersCount: (currentProgress.ordersCount || 0) + 1,
        volume: (currentProgress.volume || 0) + orderTotal,
      };

      // Check completion
      let isCompleted = false;
      if (conditions.minOrders && newProgress.ordersCount >= conditions.minOrders) {
        isCompleted = true;
      }
      if (conditions.minVolume && newProgress.volume >= conditions.minVolume) {
        isCompleted = true;
      }

      await this.prisma.merchantPromotionProgress.upsert({
        where: { merchantId_promotionId: { merchantId, promotionId: promotion.id } },
        update: {
          progress: newProgress,
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
        },
        create: {
          merchantId,
          promotionId: promotion.id,
          progress: newProgress,
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
        },
      });

      this.logger.log(`Updated promotion ${promotion.id} progress for merchant ${merchantId}`);
    }
  }
}


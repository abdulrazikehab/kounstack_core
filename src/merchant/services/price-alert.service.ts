import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePriceAlertDto, PriceAlertListQuery } from '../dto';

@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name);

  constructor(private prisma: PrismaService) {}

  // Get all price alerts for merchant
  async findAll(merchantId: string, query: PriceAlertListQuery) {
    const where: any = { merchantId, isActive: true };

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.alertType) {
      where.alertType = query.alertType.toUpperCase().replace(/_/g, '_');
    }

    const alerts = await this.prisma.priceAlertSubscription.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            image: true,
            wholesalePrice: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return alerts.map((a: any) => ({
      id: a.id,
      productId: a.productId,
      productName: a.product.name,
      productNameAr: a.product.nameAr,
      productImage: a.product.image,
      currentPrice: Number(a.product.wholesalePrice),
      alertType: a.alertType.toLowerCase(),
      isActive: a.isActive,
      lastNotifiedAt: a.lastNotifiedAt,
      lastNotifiedPrice: a.lastNotifiedPrice ? Number(a.lastNotifiedPrice) : null,
      createdAt: a.createdAt,
    }));
  }

  // Create price alert
  async create(merchantId: string, dto: CreatePriceAlertDto) {
    const alertType = dto.alertType.toUpperCase().replace(/_/g, '_') as 'ANY_CHANGE' | 'DROP_ONLY' | 'RISE_ONLY';

    // Validate product exists
    const product = await this.prisma.cardProduct.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check for existing subscription
    const existing = await this.prisma.priceAlertSubscription.findUnique({
      where: {
        merchantId_productId_alertType: {
          merchantId,
          productId: dto.productId,
          alertType,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Alert subscription already exists');
    }

    const alert = await this.prisma.priceAlertSubscription.create({
      data: {
        merchantId,
        productId: dto.productId,
        alertType,
        isActive: true,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            image: true,
            wholesalePrice: true,
          },
        },
      },
    });

    this.logger.log(`Created price alert for product ${dto.productId} merchant ${merchantId}`);

    return {
      id: alert.id,
      productId: alert.productId,
      productName: alert.product.name,
      productNameAr: alert.product.nameAr,
      productImage: alert.product.image,
      currentPrice: Number(alert.product.wholesalePrice),
      alertType: alert.alertType.toLowerCase(),
      isActive: alert.isActive,
      createdAt: alert.createdAt,
    };
  }

  // Delete price alert
  async delete(merchantId: string, alertId: string) {
    const alert = await this.prisma.priceAlertSubscription.findFirst({
      where: { id: alertId, merchantId },
    });

    if (!alert) {
      throw new NotFoundException('Price alert not found');
    }

    await this.prisma.priceAlertSubscription.delete({
      where: { id: alertId },
    });

    this.logger.log(`Deleted price alert ${alertId}`);

    return { ok: true };
  }

  // Toggle price alert active status
  async toggle(merchantId: string, alertId: string) {
    const alert = await this.prisma.priceAlertSubscription.findFirst({
      where: { id: alertId, merchantId },
    });

    if (!alert) {
      throw new NotFoundException('Price alert not found');
    }

    const updated = await this.prisma.priceAlertSubscription.update({
      where: { id: alertId },
      data: { isActive: !alert.isActive },
    });

    return { ok: true, isActive: updated.isActive };
  }

  // Process price change and send notifications (called when product price changes)
  async processPriceChange(productId: string, oldPrice: number, newPrice: number, changedByUserId?: string, reason?: string) {
    // Record price history
    await this.prisma.productPriceHistory.create({
      data: {
        productId,
        currency: 'SAR',
        oldPrice,
        newPrice,
        changedByUserId,
        reason,
      },
    });

    // Find affected subscriptions
    const subscriptions = await this.prisma.priceAlertSubscription.findMany({
      where: {
        productId,
        isActive: true,
      },
      include: {
        merchant: { select: { id: true } },
        product: { select: { name: true, nameAr: true } },
      },
    });

    for (const sub of subscriptions) {
      const priceDropped = newPrice < oldPrice;
      const priceRose = newPrice > oldPrice;

      // Check if alert type matches price change direction
      let shouldNotify = false;
      if (sub.alertType === 'ANY_CHANGE') {
        shouldNotify = true;
      } else if (sub.alertType === 'DROP_ONLY' && priceDropped) {
        shouldNotify = true;
      } else if (sub.alertType === 'RISE_ONLY' && priceRose) {
        shouldNotify = true;
      }

      if (shouldNotify) {
        // Create notification
        const changePercent = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
        const direction = priceDropped ? 'dropped' : 'increased';
        const directionAr = priceDropped ? 'انخفض' : 'ارتفع';

        await this.prisma.merchantNotification.create({
          data: {
            merchantId: sub.merchantId,
            type: 'PRICE_ALERT',
            titleEn: `Price ${direction} for ${sub.product.name}`,
            titleAr: `${directionAr} السعر لـ ${sub.product.nameAr || sub.product.name}`,
            bodyEn: `Price changed from ${oldPrice} to ${newPrice} SAR (${changePercent}%)`,
            bodyAr: `تغير السعر من ${oldPrice} إلى ${newPrice} ر.س (${changePercent}%)`,
            data: {
              productId,
              oldPrice,
              newPrice,
              changePercent: Number(changePercent),
            },
          },
        });

        // Update subscription with last notified info
        await this.prisma.priceAlertSubscription.update({
          where: { id: sub.id },
          data: {
            lastNotifiedAt: new Date(),
            lastNotifiedPrice: newPrice,
          },
        });
      }
    }

    this.logger.log(`Processed price change for product ${productId}: ${oldPrice} -> ${newPrice}`);
  }

  // Get product price history
  async getPriceHistory(tenantId: string, productId: string, limit = 30) {
    // Verify product belongs to tenant
    const product = await this.prisma.cardProduct.findFirst({
      where: { 
        id: productId,
        tenantId // Security check
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const history = await this.prisma.productPriceHistory.findMany({
      where: { productId },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });

    return history.map((h: any) => ({
      id: h.id,
      oldPrice: Number(h.oldPrice),
      newPrice: Number(h.newPrice),
      changePercent: ((Number(h.newPrice) - Number(h.oldPrice)) / Number(h.oldPrice) * 100).toFixed(1),
      changedAt: h.changedAt,
      reason: h.reason,
    }));
  }
}


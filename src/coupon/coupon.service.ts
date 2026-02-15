import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSyncService } from '../tenant/tenant-sync.service';
import { CouponType } from '@prisma/client';

@Injectable()
export class CouponService {
  constructor(
    private prisma: PrismaService,
    private tenantSyncService: TenantSyncService,
  ) {}

  async create(tenantId: string, data: any) {
    await this.tenantSyncService.ensureTenantExists(tenantId);
    return this.prisma.coupon.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.coupon.findMany({
      where: { tenantId },
    });
  }

  async findOne(tenantId: string, id: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, tenantId },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon with ID ${id} not found`);
    }

    return coupon;
  }

  async findByCode(tenantId: string, code: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { code, tenantId },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon with code ${code} not found`);
    }

    return coupon;
  }

  async validate(tenantId: string, code: string, cartTotal: number) {
    const coupon = await this.findByCode(tenantId, code);

    if (!coupon.isActive) {
      throw new BadRequestException('Coupon is not active');
    }

    const now = new Date();
    if (coupon.validFrom && coupon.validFrom > now) {
      throw new BadRequestException('Coupon is not yet valid');
    }

    if (coupon.validUntil && coupon.validUntil < now) {
      throw new BadRequestException('Coupon has expired');
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('Coupon usage limit reached');
    }

    if (coupon.minimumAmount && cartTotal < Number(coupon.minimumAmount)) {
      throw new BadRequestException(`Minimum order amount of ${coupon.minimumAmount} required`);
    }

    return coupon;
  }

  calculateDiscount(coupon: any, cartTotal: number): number {
    if (coupon.type === CouponType.PERCENTAGE) {
      return cartTotal * (Number(coupon.value) / 100);
    } else if (coupon.type === CouponType.FIXED_AMOUNT) {
      return Math.min(Number(coupon.value), cartTotal);
    } else if (coupon.type === CouponType.FREE_SHIPPING) {
      return 0; // Handled separately in shipping calculation
    }
    return 0;
  }

  async update(tenantId: string, id: string, data: any) {
    await this.findOne(tenantId, id);
    return this.prisma.coupon.update({
      where: { id },
      data,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.coupon.delete({
      where: { id },
    });
  }
}

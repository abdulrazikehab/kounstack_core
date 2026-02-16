// apps/app-core/src/brand/brand.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

export interface CreateBrandDto {
  name: string;
  nameAr?: string;
  code?: string;
  shortName?: string;
  logo?: string;
  brandType?: string;
  status?: string;
  rechargeUsdValue?: number;
  usdValueForCoins?: number;
  safetyStock?: number;
  leadTime?: number;
  reorderPoint?: number;
  averageConsumptionPerMonth?: number;
  averageConsumptionPerDay?: number;
  abcAnalysis?: string;
  odooCategoryId?: string;
  // Quantity slider fields for supplier API integration
  minQuantity?: number;
  maxQuantity?: number;
  enableSlider?: boolean;
  applySliderToAllProducts?: boolean;
  parentCategoryId?: string; // Link to parent category for hierarchy
  priceExceed?: boolean;
}

export interface UpdateBrandDto {
  name?: string;
  nameAr?: string;
  code?: string;
  shortName?: string;
  logo?: string;
  brandType?: string;
  status?: string;
  rechargeUsdValue?: number;
  usdValueForCoins?: number;
  safetyStock?: number;
  leadTime?: number;
  reorderPoint?: number;
  averageConsumptionPerMonth?: number;
  averageConsumptionPerDay?: number;
  abcAnalysis?: string;
  odooCategoryId?: string;
  minQuantity?: number;
  maxQuantity?: number;
  enableSlider?: boolean;
  applySliderToAllProducts?: boolean;
  parentCategoryId?: string; // Link to parent category for hierarchy
  priceExceed?: boolean;
}

@Injectable()
export class BrandService {
  private readonly logger = new Logger(BrandService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService
  ) {}

  async create(tenantId: string, data: CreateBrandDto) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Graceful fallback when running against auth-only schema without brand model.
    if (!(this.prisma as any).prisma?.brand) {
      const now = new Date();
      const virtualBrand = {
        id: `virtual-brand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        name: data.name,
        nameAr: data.nameAr ?? null,
        code: data.code ?? null,
        shortName: data.shortName ?? null,
        logo: data.logo ?? null,
        brandType: data.brandType ?? null,
        status: data.status || 'Active',
        parentCategoryId: data.parentCategoryId ?? null,
        minQuantity: data.minQuantity ?? null,
        maxQuantity: data.maxQuantity ?? null,
        enableSlider: data.enableSlider ?? false,
        applySliderToAllProducts: data.applySliderToAllProducts ?? false,
        priceExceed: data.priceExceed ?? false,
        createdAt: now,
        updatedAt: now,
      };
      this.logger.warn(
        `Brand model unavailable in current schema. Returning virtual brand for tenant ${tenantId}.`,
      );
      return virtualBrand as any;
    }

    // If a code is provided, make brand creation idempotent per (tenantId, code)
    // Return existing brand instead of throwing on duplicates.
    if (data.code) {
      const existingBrand = await this.prisma.brand.findFirst({
        where: {
          tenantId,
          code: data.code,
        },
      });

      if (existingBrand) {
        this.logger.log(
          `Brand already exists for tenant ${tenantId} with code ${data.code}. Returning existing brand.`,
        );
        return existingBrand;
      }
    }

    // CRITICAL FIX: Auto-create tenant if it doesn't exist
    // This ensures the system works with ANY tenantId without manual tenant setup
    try {
      const tenantExists = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });

      if (!tenantExists) {
        this.logger.warn(`Tenant ${tenantId} not found. Auto-creating tenant...`);
        try {
          await this.prisma.tenant.create({
            data: {
              id: tenantId,
              name: 'Default Store',
              subdomain: `store-${tenantId.substring(0, 8)}`,
              plan: 'STARTER',
              status: 'ACTIVE',
            },
          });
          this.logger.log(`✅ Auto-created tenant ${tenantId}`);
        } catch (tenantError: any) {
          // If tenant creation fails due to unique constraint (race condition), ignore
          if (tenantError?.code !== 'P2002') {
            this.logger.error(`Failed to auto-create tenant: ${tenantError?.message}`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Error checking tenant existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      const brand = await this.prisma.brand.create({
        data: {
          tenantId,
          name: data.name,
          nameAr: data.nameAr,
          code: data.code,
          shortName: data.shortName,
          logo: data.logo,
          brandType: data.brandType,
          status: data.status || 'Active',
          rechargeUsdValue: data.rechargeUsdValue ? Number(data.rechargeUsdValue) : 0,
          usdValueForCoins: data.usdValueForCoins ? Number(data.usdValueForCoins) : 0,
          safetyStock: data.safetyStock ? Number(data.safetyStock) : 0,
          leadTime: data.leadTime ? Number(data.leadTime) : 0,
          reorderPoint: data.reorderPoint ? Number(data.reorderPoint) : 0,
          averageConsumptionPerMonth: data.averageConsumptionPerMonth ? Number(data.averageConsumptionPerMonth) : 0,
          averageConsumptionPerDay: data.averageConsumptionPerDay ? Number(data.averageConsumptionPerDay) : 0,
          abcAnalysis: data.abcAnalysis,
          odooCategoryId: data.odooCategoryId,
          minQuantity: data.minQuantity ? Number(data.minQuantity) : undefined,
          maxQuantity: data.maxQuantity ? Number(data.maxQuantity) : undefined,
          enableSlider: data.enableSlider || false,
          applySliderToAllProducts: data.applySliderToAllProducts || false,
          parentCategoryId: data.parentCategoryId || undefined,
          priceExceed: data.priceExceed || false,
        },
      });

      this.logger.log(`Brand created: ${brand.id} for tenant ${tenantId}`);

      // Handle logo renaming if it's a Cloudinary URL
      if (brand.logo && brand.logo.includes('cloudinary.com')) {
        const newLogoUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
          brand.logo,
          `brand_${brand.id}`
        );
        if (newLogoUrl !== brand.logo) {
          return await this.prisma.brand.update({
            where: { id: brand.id },
            data: { logo: newLogoUrl },
          });
        }
      }

      return brand;
    } catch (error: any) {
      // Handle unique constraint on (tenantId, code)
      if (error?.code === 'P2002' && data.code) {
        this.logger.warn(
          `Duplicate brand code detected for tenant ${tenantId}: ${data.code}`,
        );

        // In case of race condition, try to load existing brand and return it
        const existingBrand = await this.prisma.brand.findFirst({
          where: {
            tenantId,
            code: data.code,
          },
        });

        if (existingBrand) {
          return existingBrand;
        }

        // Fallback: return a clear validation error
        throw new BadRequestException(
          'A brand with this code already exists for your store. Please use a different code.',
        );
      }
      
      this.logger.error(`Failed to create brand: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create brand: ${error.message}`);
    }
  }

  async findAll(tenantId: string, page: number = 1, limit: number = 20) {
    if (!tenantId) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    try {
      const skip = (page - 1) * limit;
      
      const [total, brands] = await Promise.all([
        this.prisma.brand.count({ where: { tenantId } }),
        this.prisma.brand.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          // Don't include tenant relation to avoid querying non-existent fields
        })
      ]);

      return {
        data: brands,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error: any) {
      this.logger.error(`❌ Error fetching brands for tenant ${tenantId}:`, error);
      this.logger.error(`Error details:`, {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
      });
      
      // If tenant doesn't exist in database, return empty array
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        this.logger.warn(`⚠️ Tenant ${tenantId} does not exist in database. Returning empty brands list.`);
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      
      // If it's a column not found error, try to handle it gracefully
      if (error?.message?.includes('does not exist') || 
          error?.message?.includes('column') && error?.message?.includes('does not exist') ||
          error?.code === 'P2021' ||
          error?.code === 'P2010') {
        this.logger.error(`⚠️ Database schema mismatch detected. Error: ${error.message}`);
        this.logger.error(`⚠️ This usually means the database schema is out of sync with Prisma schema.`);
        // Return empty array to prevent breaking the UI
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      
      throw error;
    }
  }

  async findOne(tenantId: string, id: string) {
    this.logger.debug(`Finding brand ${id} for tenant ${tenantId}`);
    
    const brand = await this.prisma.brand.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!brand) {
      // Check if brand exists but for different tenant
      const brandExists = await this.prisma.brand.findFirst({
        where: { id },
        select: { tenantId: true },
      });
      
      if (brandExists) {
        this.logger.warn(`Brand ${id} exists but belongs to tenant ${brandExists.tenantId}, not ${tenantId}`);
        throw new NotFoundException(`Brand not found for tenant ${tenantId}`);
      }
      
      this.logger.warn(`Brand ${id} not found at all`);
      throw new NotFoundException(`Brand ${id} not found`);
    }

    return brand;
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.brand.findFirst({
      where: {
        tenantId,
        code,
      },
    });
  }

  async update(tenantId: string, id: string, data: UpdateBrandDto) {
    await this.findOne(tenantId, id);

    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        code: data.code,
        shortName: data.shortName,
        logo: data.logo,
        brandType: data.brandType,
        status: data.status,
        rechargeUsdValue: data.rechargeUsdValue,
        usdValueForCoins: data.usdValueForCoins,
        safetyStock: data.safetyStock,
        leadTime: data.leadTime,
        reorderPoint: data.reorderPoint,
        averageConsumptionPerMonth: data.averageConsumptionPerMonth,
        averageConsumptionPerDay: data.averageConsumptionPerDay,
        abcAnalysis: data.abcAnalysis,
        odooCategoryId: data.odooCategoryId,
        minQuantity: data.minQuantity,
        maxQuantity: data.maxQuantity,
        enableSlider: data.enableSlider,
        applySliderToAllProducts: data.applySliderToAllProducts,
        parentCategoryId: data.parentCategoryId,
        priceExceed: data.priceExceed,
      },
    });

    this.logger.log(`Brand updated: ${id}`);

    // Handle logo renaming if it's a Cloudinary URL and was updated
    if (updated.logo && updated.logo.includes('cloudinary.com')) {
      const newLogoUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
        updated.logo,
        `brand_${updated.id}`
      );
      if (newLogoUrl !== updated.logo) {
        return await this.prisma.brand.update({
          where: { id: updated.id },
          data: { logo: newLogoUrl },
        });
      }
    }

    return updated;
  }

  async remove(tenantId: string, id: string) {
    this.logger.debug(`Attempting to delete brand ${id} for tenant ${tenantId}`);
    
    // Check if brand exists first
    const brand = await this.prisma.brand.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!brand) {
      // Check if brand exists but for different tenant
      const brandExists = await this.prisma.brand.findFirst({
        where: { id },
        select: { tenantId: true },
      });
      
      if (brandExists) {
        this.logger.warn(`Brand ${id} exists but belongs to tenant ${brandExists.tenantId}, not ${tenantId}`);
        throw new BadRequestException(`Brand not found for tenant ${tenantId}`);
      }
      
      this.logger.warn(`Brand ${id} not found at all`);
      throw new BadRequestException(`Brand ${id} not found`);
    }

    // Check if brand is used in any products
    const productCount = await this.prisma.product.count({
      where: {
        brandId: id,
        tenantId,
      },
    });

    if (productCount > 0) {
      this.logger.warn(`Cannot delete brand ${id}: used in ${productCount} products`);
      throw new BadRequestException(`Cannot delete brand that is used in ${productCount} product(s). Please remove the brand from products first.`);
    }

    await this.prisma.brand.delete({
      where: { id },
    });

    this.logger.log(`Brand deleted: ${id}`);
    return { message: 'Brand deleted successfully' };
  }
}


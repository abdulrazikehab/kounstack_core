// apps/app-core/src/unit/unit.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';

export interface CreateUnitDto {
  name: string;
  nameAr?: string;
  code: string;
  symbol?: string;
  cost: number;
  description?: string;
}

export interface UpdateUnitDto {
  name?: string;
  nameAr?: string;
  code?: string;
  symbol?: string;
  cost?: number;
  isActive?: boolean;
  description?: string;
}

@Injectable()
export class UnitService {
  private readonly logger = new Logger(UnitService.name);

  constructor(
    private prisma: PrismaService,
    private currencyService: CurrencyService,
  ) {}

  async create(tenantId: string, data: CreateUnitDto) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check if code already exists for this tenant
    const existing = await this.prisma.unit.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: data.code.toUpperCase(),
        },
      },
    });

    if (existing) {
      throw new BadRequestException(`Unit with code ${data.code} already exists`);
    }

    // Get base currency to ensure cost is in base currency
    const currencySettings = await this.currencyService.getSettings(tenantId);
    if (!currencySettings) {
      this.logger.warn(`No currency settings found for tenant ${tenantId}, using default`);
    }

    const unit = await this.prisma.unit.create({
      data: {
        tenantId,
        name: data.name,
        nameAr: data.nameAr,
        code: data.code.toUpperCase(),
        symbol: data.symbol,
        cost: data.cost,
        description: data.description,
      },
    });

    this.logger.log(`Unit created: ${unit.id} (${unit.code}) for tenant ${tenantId}`);
    return unit;
  }

  async findAll(tenantId: string, includeInactive: boolean = false) {
    try {
      if (!tenantId) {
        this.logger.error('findAll called with null/undefined tenantId');
        throw new BadRequestException('Tenant ID is required');
      }

      const where: any = { tenantId };
      if (!includeInactive) {
        where.isActive = true;
      }

      return await this.prisma.unit.findMany({
        where,
        orderBy: { code: 'asc' },
      });
    } catch (error: any) {
      this.logger.error(`Error in findAll units for tenant ${tenantId}:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch units: ${error?.message || 'Unknown error'}`);
    }
  }

  async findOne(tenantId: string, id: string) {
    const unit = await this.prisma.unit.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!unit) {
      throw new NotFoundException('Unit not found');
    }

    return unit;
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.unit.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: code.toUpperCase(),
        },
      },
    });
  }

  async update(tenantId: string, id: string, data: UpdateUnitDto) {
    await this.findOne(tenantId, id);

    // If code is being updated, check uniqueness
    if (data.code) {
      const existing = await this.prisma.unit.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: data.code.toUpperCase(),
          },
        },
      });

      if (existing && existing.id !== id) {
        throw new BadRequestException(`Unit with code ${data.code} already exists`);
      }
    }

    const updated = await this.prisma.unit.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        code: data.code?.toUpperCase(),
        symbol: data.symbol,
        cost: data.cost,
        isActive: data.isActive,
        description: data.description,
      },
    });

    this.logger.log(`Unit updated: ${id}`);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    // Check if unit is used in any products
    const productCount = await this.prisma.product.count({
      where: {
        unitId: id,
        tenantId,
      },
    });

    if (productCount > 0) {
      // Soft delete by setting isActive to false
      return this.prisma.unit.update({
        where: { id },
        data: { isActive: false },
      });
    }

    await this.prisma.unit.delete({
      where: { id },
    });

    this.logger.log(`Unit deleted: ${id}`);
  }
}


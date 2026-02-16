import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateEmergencyItemDto } from './dto/create-emergency-item.dto';
import { BulkUpdateVisibilityDto, InventoryType, EntityType } from './dto/update-visibility.dto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  async upsertEmergencyItems(tenantId: string, items: CreateEmergencyItemDto[]) {
    let inserted = 0;
    let updated = 0;
    
    for (const item of items) {
      try {
        const existing = await this.prisma.emergencyInventory.findUnique({
          where: {
            tenantId_productId: {
              tenantId,
              productId: item.productId,
            },
          },
        });

        if (existing) {
            await this.prisma.emergencyInventory.update({
                where: { id: existing.id },
                data: {
                    reason: item.reason,
                    notes: item.notes,
                }
            });
            updated++;
        } else {
            await this.prisma.emergencyInventory.create({
                data: {
                    tenantId,
                    productId: item.productId,
                    reason: item.reason,
                    notes: item.notes,
                }
            });
            inserted++;
        }
      } catch (error) {
        this.logger.error(`Failed to upsert emergency item ${item.productId}:`, error);
      }
    }

    return { inserted, updated };
  }

  async getEmergencyInventory(tenantId: string, page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.EmergencyInventoryWhereInput = {
      tenantId,
      product: search ? {
        OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { nameAr: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } }
        ]
      } : undefined
    };

    const [data, total] = await Promise.all([
      this.prisma.emergencyInventory.findMany({
        where,
        include: {
          product: true
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.emergencyInventory.count({ where })
    ]);

    return { data, total };
  }

  async removeEmergencyItem(tenantId: string, productId: string) {
    return this.prisma.emergencyInventory.delete({
      where: {
        tenantId_productId: {
            tenantId,
            productId
        }
      }
    });
  }

  async autoAddCostGtPrice(tenantId: string) {
    // Find products where cost > price
    // Prisma decimal comparison can be tricky, often better to do in raw query if complex, 
    // but here we can try fetching potential candidates or using updateMany isn't possible across tables easily for this condition.
    // We'll iterate for safety and correctness in logic, though less performant for massive db. 
    // Actually, costPerItem > price.
    
    // Using FindMany
    const products = await this.prisma.product.findMany({
        where: {
            tenantId,
            costPerItem: { not: null },
        },
        select: { id: true, price: true, costPerItem: true }
    });

    const candidates = products.filter(p => p.costPerItem && p.costPerItem.comparedTo(p.price) > 0);
    
    const items = candidates.map(p => ({
        productId: p.id,
        reason: 'cost_gt_price',
        notes: 'Auto-added: Cost > Price'
    }));

    return this.upsertEmergencyItems(tenantId, items);
  }

  async autoAddNeeded(tenantId: string) {
    const products = await this.prisma.product.findMany({
        where: {
            tenantId,
            isNeeded: true
        },
        select: { id: true }
    });

    const items = products.map(p => ({
        productId: p.id,
        reason: 'needed',
        notes: 'Auto-added: Marked as Needed'
    }));

     return this.upsertEmergencyItems(tenantId, items);
  }

  async updateVisibility(tenantId: string, dto: BulkUpdateVisibilityDto) {
    const { inventoryType, changes } = dto;
    let up = 0;

    for (const change of changes) {
        // Upsert override
        const existing = await this.prisma.inventoryVisibilityOverride.findUnique({
             where: {
                 tenantId_inventoryType_entityType_entityId: {
                     tenantId,
                     inventoryType,
                     entityType: change.entityType,
                     entityId: change.entityId
                 }
             }
        });

        if (existing) {
            await this.prisma.inventoryVisibilityOverride.update({
                where: { id: existing.id },
                data: { isActive: change.isActive }
            });
        } else {
            await this.prisma.inventoryVisibilityOverride.create({
                data: {
                    tenantId,
                    inventoryType,
                    entityType: change.entityType,
                    entityId: change.entityId,
                    isActive: change.isActive
                }
            });
        }
        up++;
    }
    return { updated: up };
  }

  // Get effective settings for Setup page
  async getSetup(tenantId: string, inventoryType: InventoryType, entityType: EntityType, page = 1, limit = 50, search?: string) {
    const skip = (page - 1) * limit;

    // We need to fetch entities and LEFT JOIN with overrides to show current status
    // Prisma doesn't do polymorphic joins well, so we handle by type.
    
    if (entityType === EntityType.PRODUCT) {
        const where: Prisma.ProductWhereInput = {
            tenantId,
            OR: search ? [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } }
            ] : undefined
        };
        const [products, total] = await Promise.all([
             this.prisma.product.findMany({ 
                 where, 
                 skip, 
                 take: limit, 
                 select: { id: true, name: true, nameAr: true, sku: true, isAvailable: true } 
             }),
             this.prisma.product.count({ where })
        ]);

        const ids = products.map(p => p.id);
        const overrides = await this.prisma.inventoryVisibilityOverride.findMany({
            where: {
                tenantId,
                inventoryType,
                entityType,
                entityId: { in: ids }
            }
        });
        
        const overrideMap = new Map(overrides.map(o => [o.entityId, o.isActive]));

        const results = products.map(p => ({
            ...p,
            globalActive: p.isAvailable,
            inventoryActive: overrideMap.has(p.id) ? overrideMap.get(p.id) : p.isAvailable, // Default to global if no override
            hasOverride: overrideMap.has(p.id)
        }));

        return { data: results, total };

    } else if (entityType === EntityType.CATEGORY) {
        const where: Prisma.CategoryWhereInput = {
             tenantId,
             name: search ? { contains: search, mode: 'insensitive' } : undefined
        };
        const [categories, total] = await Promise.all([
             this.prisma.category.findMany({ 
                 where, 
                 skip, 
                 take: limit,
                 select: { id: true, name: true, nameAr: true, isActive: true }
             }),
             this.prisma.category.count({ where })
        ]);
        
        const ids = categories.map(c => c.id);
        const overrides = await this.prisma.inventoryVisibilityOverride.findMany({
            where: {
                tenantId,
                inventoryType,
                entityType,
                entityId: { in: ids }
            }
        });
         const overrideMap = new Map(overrides.map(o => [o.entityId, o.isActive]));
         
         const results = categories.map(c => ({
            ...c,
            globalActive: c.isActive,
            inventoryActive: overrideMap.has(c.id) ? overrideMap.get(c.id) : c.isActive,
            hasOverride: overrideMap.has(c.id)
        }));
        return { data: results, total };

    } else if (entityType === EntityType.BRAND) {
        const where: Prisma.BrandWhereInput = {
            tenantId,
             name: search ? { contains: search, mode: 'insensitive' } : undefined
        };
         const [brands, total] = await Promise.all([
             this.prisma.brand.findMany({ 
                 where, 
                 skip, 
                 take: limit,
                 select: { id: true, name: true, nameAr: true, status: true }
             }),
             this.prisma.brand.count({ where })
        ]);
        
        const ids = brands.map(b => b.id);
        const overrides = await this.prisma.inventoryVisibilityOverride.findMany({
            where: {
                tenantId,
                inventoryType,
                entityType,
                entityId: { in: ids }
            }
        });
         const overrideMap = new Map(overrides.map(o => [o.entityId, o.isActive]));
         
         // Map status to boolean: "Active" = true, anything else = false
         const results = brands.map(b => {
            const globalActive = b.status === 'Active';
            return {
                ...b,
                globalActive,
                inventoryActive: overrideMap.has(b.id) ? overrideMap.get(b.id) : globalActive,
                hasOverride: overrideMap.has(b.id)
            };
        });
        return { data: results, total };
    }
    
    return { data: [], total: 0 };
  }
}

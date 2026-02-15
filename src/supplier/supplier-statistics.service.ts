import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SupplierStatistics {
  supplierId: string;
  supplierName: string;
  totalPurchases: number;
  totalSpent: number;
  totalQuantity: number;
  averagePrice: number;
  productsPurchased: Array<{
    productId: string;
    productName: string;
    quantity: number;
    totalSpent: number;
    averagePrice: number;
    lastPurchaseDate: string;
  }>;
  inventoryAlerts: Array<{
    productId: string;
    productName: string;
    currentQuantity: number;
    supplierQuantity?: number;
    threshold: number;
    alertLevel: 'critical' | 'warning' | 'low';
    needsRecharge: boolean;
  }>;
}

@Injectable()
export class SupplierStatisticsService {
  private readonly logger = new Logger(SupplierStatisticsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get statistics for a specific supplier
   */
  async getSupplierStatistics(tenantId: string, supplierId: string): Promise<SupplierStatistics> {
    // Get supplier info
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });

    if (!supplier) {
      throw new Error(`Supplier ${supplierId} not found`);
    }

    // Get all purchases for this supplier
    const purchases = await this.prisma.supplierPurchase.findMany({
      where: {
        tenantId,
        supplierId,
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            nameAr: true,
          },
        },
      },
      orderBy: {
        purchaseDate: 'desc',
      },
    });

    // Calculate statistics
    const totalPurchases = purchases.length;
    const totalSpent = purchases.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
    const totalQuantity = purchases.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
    const averagePrice = totalPurchases > 0 ? totalSpent / totalQuantity : 0;

    // Group purchases by product
    const productMap = new Map<string, {
      productId: string;
      productName: string;
      quantity: number;
      totalSpent: number;
      purchases: typeof purchases;
    }>();

    purchases.forEach((purchase) => {
      const productId = purchase.productId;
      const existing = productMap.get(productId);

      if (existing) {
        existing.quantity += Number(purchase.quantity || 0);
        existing.totalSpent += Number(purchase.totalAmount || 0);
        existing.purchases.push(purchase);
      } else {
        productMap.set(productId, {
          productId,
          productName: purchase.product?.nameAr || purchase.product?.name || 'Unknown Product',
          quantity: Number(purchase.quantity || 0),
          totalSpent: Number(purchase.totalAmount || 0),
          purchases: [purchase],
        });
      }
    });

    const productsPurchased = Array.from(productMap.values()).map((product) => ({
      productId: product.productId,
      productName: product.productName,
      quantity: product.quantity,
      totalSpent: product.totalSpent,
      averagePrice: product.quantity > 0 ? product.totalSpent / product.quantity : 0,
      lastPurchaseDate: product.purchases[0]?.purchaseDate?.toISOString() || new Date().toISOString(),
    }));

    // Get inventory alerts for products linked to this supplier
    const inventoryAlerts = await this.getInventoryAlerts(tenantId, supplierId);

    return {
      supplierId,
      supplierName: supplier.nameAr || supplier.name,
      totalPurchases,
      totalSpent,
      totalQuantity,
      averagePrice,
      productsPurchased,
      inventoryAlerts,
    };
  }

  /**
   * Get all suppliers statistics
   */
  async getAllSuppliersStatistics(tenantId: string): Promise<SupplierStatistics[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId, isActive: true },
    });

    const statistics = await Promise.all(
      suppliers.map((supplier) =>
        this.getSupplierStatistics(tenantId, supplier.id).catch((error) => {
          this.logger.error(`Error getting statistics for supplier ${supplier.id}:`, error);
          return null;
        })
      )
    );

    return statistics.filter((s): s is SupplierStatistics => s !== null);
  }

  /**
   * Get inventory alerts for products linked to a supplier
   */
  private async getInventoryAlerts(
    tenantId: string,
    supplierId: string,
  ): Promise<SupplierStatistics['inventoryAlerts']> {
    // Get products linked to this supplier
    const productSuppliers = await this.prisma.productSupplier.findMany({
      where: {
        supplierId,
        product: {
          tenantId,
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            variants: {
              select: {
                id: true,
                inventoryQuantity: true,
              },
            },
          },
        },
      },
    });

    const alerts: SupplierStatistics['inventoryAlerts'] = [];

    for (const ps of productSuppliers) {
      const product = ps.product;
      
      // Get total inventory across all variants
      const totalInventory = product.variants.reduce(
        (sum, v) => sum + Number(v.inventoryQuantity || 0),
        0
      );

      // Default threshold is 10, but can be customized per supplier
      // You might want to add a threshold field to ProductSupplier model
      const threshold = 10; // Default low inventory threshold
      const criticalThreshold = 5;
      
      let alertLevel: 'critical' | 'warning' | 'low' = 'low';
      let needsRecharge = false;

      if (totalInventory <= criticalThreshold) {
        alertLevel = 'critical';
        needsRecharge = true;
      } else if (totalInventory <= threshold) {
        alertLevel = 'warning';
        needsRecharge = true;
      } else if (totalInventory <= threshold * 1.5) {
        alertLevel = 'low';
      }

      // Only add alert if inventory is low
      if (totalInventory <= threshold * 1.5) {
        alerts.push({
          productId: product.id,
          productName: product.nameAr || product.name,
          currentQuantity: totalInventory,
          threshold,
          alertLevel,
          needsRecharge,
        });
      }
    }

    return alerts.sort((a, b) => {
      // Sort by alert level: critical first, then warning, then low
      const levelOrder = { critical: 0, warning: 1, low: 2 };
      return levelOrder[a.alertLevel] - levelOrder[b.alertLevel];
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SupplierPrice {
  supplierId: string;
  supplierName: string;
  price: number;
  available: boolean;
  productCode?: string;
}

export interface BestSupplierResult {
  supplierId: string;
  supplierName: string;
  price: number;
  shouldPurchase: boolean;
  reason: string;
}

@Injectable()
export class SupplierPricingService {
  private readonly logger = new Logger(SupplierPricingService.name);

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
  ) {}

  /**
   * Fetch price from a supplier API
   */
  async fetchSupplierPrice(
    tenantId: string,
    productId: string,
    supplierId: string,
  ): Promise<SupplierPrice | null> {
    try {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId, isActive: true },
      });

      if (!supplier || !supplier.apiEndpoint) {
        this.logger.warn(`Supplier ${supplierId} not found or has no API endpoint`);
        return null;
      }

      const productSupplier = await this.prisma.productSupplier.findFirst({
        where: { productId, supplierId },
        include: { product: true },
      });

      if (!productSupplier) {
        this.logger.warn(`Product ${productId} not linked to supplier ${supplierId}`);
        return null;
      }

      // Build API request
      const apiUrl = `${supplier.apiEndpoint}/price`;
      const headers: any = {
        'Content-Type': 'application/json',
      };

      // Add API key if available
      if (supplier.apiKey) {
        headers['Authorization'] = `Bearer ${supplier.apiKey}`;
        // Or use API key in header based on config
        const apiConfig = supplier.apiConfig as any;
        if (apiConfig?.authType === 'header') {
          headers[apiConfig.authHeader || 'X-API-Key'] = supplier.apiKey;
        }
      }

      // Request body with product information
      const requestBody = {
        productCode: productSupplier.supplierProductCode || productSupplier.product.productCode || productSupplier.product.sku,
        productId: productSupplier.product.id,
      };

      // Make API call
      const response = await firstValueFrom(
        this.httpService.post(apiUrl, requestBody, { headers }),
      );

      const priceData = response.data;

      // Update last price and check time
      await this.prisma.productSupplier.update({
        where: { id: productSupplier.id },
        data: {
          lastPrice: priceData.price || priceData.amount,
          lastPriceCheck: new Date(),
        },
      });

      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        price: parseFloat(priceData.price || priceData.amount || '0'),
        available: priceData.available !== false,
        productCode: priceData.productCode,
      };
    } catch (error) {
      this.logger.error(`Error fetching price from supplier ${supplierId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch prices from all suppliers for a product
   */
  async fetchAllSupplierPrices(
    tenantId: string,
    productId: string,
  ): Promise<SupplierPrice[]> {
    const productSuppliers = await this.prisma.productSupplier.findMany({
      where: {
        productId,
        supplier: {
          tenantId,
          isActive: true,
          apiEndpoint: { not: null },
        },
      },
      include: { supplier: true },
    });

    const pricePromises = productSuppliers.map((ps) =>
      this.fetchSupplierPrice(tenantId, productId, ps.supplierId),
    );

    const prices = await Promise.all(pricePromises);
    return prices.filter((p): p is SupplierPrice => p !== null);
  }

  /**
   * Select the best supplier based on price and business logic
   * Logic: Choose supplier with lowest price if:
   * - Supplier price > product cost
   * - Supplier price < product selling price
   */
  async selectBestSupplier(
    tenantId: string,
    productId: string,
  ): Promise<BestSupplierResult | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      this.logger.warn(`Product ${productId} not found`);
      return null;
    }

    const supplierPrices = await this.fetchAllSupplierPrices(tenantId, productId);

    if (supplierPrices.length === 0) {
      return null;
    }

    const productCost = product.costPerItem ? Number(product.costPerItem) : 0;
    const productPrice = Number(product.price);

    // Filter suppliers that meet criteria:
    // 1. Price > cost (we make profit)
    // 2. Price < selling price (we can sell it)
    // 3. Product is available
    const validSuppliers = supplierPrices
      .filter((sp) => sp.available)
      .filter((sp) => {
        const supplierPrice = sp.price;
        return supplierPrice > productCost && supplierPrice < productPrice;
      })
      .sort((a, b) => a.price - b.price); // Sort by price ascending

    if (validSuppliers.length === 0) {
      return {
        supplierId: '',
        supplierName: '',
        price: 0,
        shouldPurchase: false,
        reason: 'No suppliers meet the price criteria (price must be > cost and < selling price)',
      };
    }

    const bestSupplier = validSuppliers[0];

    return {
      supplierId: bestSupplier.supplierId,
      supplierName: bestSupplier.supplierName,
      price: bestSupplier.price,
      shouldPurchase: true,
      reason: `Best price: ${bestSupplier.price} (cost: ${productCost}, selling: ${productPrice})`,
    };
  }

  /**
   * Check if we should stop purchasing from a supplier due to price changes
   */
  async shouldStopPurchase(
    tenantId: string,
    productId: string,
    supplierId: string,
  ): Promise<{ shouldStop: boolean; reason: string; currentPrice?: number }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      return { shouldStop: false, reason: 'Product not found' };
    }

    const currentPrice = await this.fetchSupplierPrice(tenantId, productId, supplierId);

    if (!currentPrice) {
      return { shouldStop: true, reason: 'Could not fetch current price from supplier' };
    }

    const productCost = product.costPerItem ? Number(product.costPerItem) : 0;
    const productPrice = Number(product.price);
    const supplierPrice = currentPrice.price;

    // Stop if price is no longer favorable
    if (supplierPrice <= productCost || supplierPrice >= productPrice) {
      return {
        shouldStop: true,
        reason: `Price ${supplierPrice} is no longer favorable (cost: ${productCost}, selling: ${productPrice})`,
        currentPrice: supplierPrice,
      };
    }

    return {
      shouldStop: false,
      reason: 'Price is still favorable',
      currentPrice: supplierPrice,
    };
  }
}


import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateOutboundUrl } from '../security/url-safety';

interface Supplier {
  id: string;
  name: string;
  apiEndpoint?: string;
  apiKey?: string;
  syncEnabled: boolean;
}

interface InventorySyncResult {
  productId: string;
  sku: string;
  currentQuantity: number;
  supplierQuantity: number;
  synced: boolean;
  error?: string;
}

@Injectable()
export class SupplierInventoryService {
  private readonly logger = new Logger(SupplierInventoryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Sync inventory for a specific product with supplier
   */
  async syncProductInventory(tenantId: string, productId: string): Promise<InventorySyncResult> {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
      include: {
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Get supplier information from product metadata or tenant settings
    const supplierInfo = await this.getSupplierInfo(tenantId, product.sku);
    
    if (!supplierInfo || !supplierInfo.syncEnabled) {
      this.logger.warn(`Supplier sync not enabled for product ${productId}`);
      return {
        productId,
        sku: product.sku || '',
        currentQuantity: 0,
        supplierQuantity: 0,
        synced: false,
        error: 'Supplier sync not enabled',
      };
    }

    try {
      // Fetch inventory from supplier API
      const supplierQuantity = await this.fetchSupplierInventory(supplierInfo, product.sku || '');
      
      // Update product variant inventory
      if (product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          await this.prisma.productVariant.update({
            where: { id: variant.id },
            data: {
              inventoryQuantity: supplierQuantity,
            },
          });
        }
      }

      this.logger.log(`Synced inventory for product ${productId}: ${supplierQuantity} units`);

      return {
        productId,
        sku: product.sku || '',
        currentQuantity: product.variants[0]?.inventoryQuantity || 0,
        supplierQuantity,
        synced: true,
      };
    } catch (error: any) {
      this.logger.error(`Failed to sync inventory for product ${productId}:`, error);
      return {
        productId,
        sku: product.sku || '',
        currentQuantity: product.variants[0]?.inventoryQuantity || 0,
        supplierQuantity: 0,
        synced: false,
        error: error.message || 'Sync failed',
      };
    }
  }

  /**
   * Sync all products inventory with suppliers
   */
  async syncAllInventory(tenantId: string): Promise<{ synced: number; failed: number; results: InventorySyncResult[] }> {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        isAvailable: true,
      },
      include: {
        variants: true,
      },
    });

    const results: InventorySyncResult[] = [];
    let synced = 0;
    let failed = 0;

    for (const product of products) {
      try {
        const result = await this.syncProductInventory(tenantId, product.id);
        results.push(result);
        if (result.synced) {
          synced++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        results.push({
          productId: product.id,
          sku: product.sku || '',
          currentQuantity: 0,
          supplierQuantity: 0,
          synced: false,
          error: String(error),
        });
      }
    }

    this.logger.log(`Inventory sync completed: ${synced} synced, ${failed} failed`);

    return { synced, failed, results };
  }

  /**
   * Get supplier information from tenant settings or product metadata
   */
  private async getSupplierInfo(tenantId: string, sku?: string): Promise<Supplier | null> {
    // Check if tenant has supplier integration configured
    const integration = await this.prisma.integration.findFirst({
      where: {
        tenantId,
        type: 'SUPPLIER',
        isActive: true,
      },
    });

    if (!integration) {
      return null;
    }

    return {
      id: integration.id,
      name: integration.name,
      apiEndpoint: (integration.settings as any)?.apiEndpoint,
      apiKey: (integration.credentials as any)?.apiKey,
      syncEnabled: integration.isActive,
    };
  }

  /**
   * Fetch inventory quantity from supplier API
   */
  private async fetchSupplierInventory(supplier: Supplier, sku: string): Promise<number> {
    if (!supplier.apiEndpoint || !supplier.apiKey) {
      throw new Error('Supplier API not configured');
    }

    // SSRF Check
    await validateOutboundUrl(supplier.apiEndpoint);

    try {
      const response = await fetch(`${supplier.apiEndpoint}/inventory/${sku}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supplier.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Supplier API returned ${response.status}`);
      }

      const data = await response.json() as { quantity?: number; stock?: number };
      return data?.quantity || data?.stock || 0;
    } catch (error: any) {
      this.logger.error(`Failed to fetch inventory from supplier ${supplier.name}:`, error);
      throw new Error(`Failed to fetch supplier inventory: ${error.message}`);
    }
  }

  /**
   * Validate inventory before order creation
   * If product has productCode, it can be fulfilled via supplier API, so allow order even if local inventory is insufficient
   */
  async validateInventoryBeforeOrder(tenantId: string, items: Array<{ productId: string; variantId?: string; quantity: number }>): Promise<boolean> {
    this.logger.log(`Validating inventory for ${items.length} items, tenantId: ${tenantId}`);
    
    for (const item of items) {
      if (item.variantId) {
        const variant = await this.prisma.productVariant.findFirst({
          where: {
            id: item.variantId,
            product: {
              tenantId,
            },
          },
          include: {
            product: {
              select: {
                productCode: true,
                id: true,
                name: true,
                nameAr: true,
                isDigital: true,
              }
            }
          }
        });

        if (!variant) {
          this.logger.error(`Variant ${item.variantId} not found for product ${item.productId}`);
          return false;
        }

        // Check if product has productCode or is digital - if yes, it can be fulfilled via supplier API
        const productCode = variant?.product?.productCode;
        const isApiProduct = !!productCode && productCode.trim() !== '';
        const isDigitalProduct = variant?.product?.isDigital === true;

        this.logger.log(`Validating item: variantId=${item.variantId}, productId=${variant.product.id}, productCode=${productCode || 'NONE'}, isDigital=${isDigitalProduct}, inventory=${variant.inventoryQuantity}, requested=${item.quantity}`);

        if (isApiProduct) {
          // Product can be fulfilled via supplier API, so allow order regardless of local inventory
          this.logger.log(`✅ Product ${variant.product.id} (${variant.product.name}) has productCode ${productCode}, allowing order (will be fulfilled via supplier API)`);
          continue; // Skip inventory check for this item
        }

        if (isDigitalProduct) {
          // Digital products can be fulfilled via supplier API even if local inventory is 0
          this.logger.log(`✅ Product ${variant.product.id} (${variant.product.name}) is digital, allowing order (will be fulfilled via supplier API)`);
          continue; // Skip inventory check for this item
        }

        // For products without productCode, check local inventory
        if (variant.inventoryQuantity < item.quantity) {
          this.logger.warn(`⚠️ Insufficient inventory for variant ${item.variantId} (${variant.product.name}): requested ${item.quantity}, available ${variant.inventoryQuantity}`);
          
          // Try to sync with supplier before failing
          const product = await this.prisma.product.findFirst({
            where: { id: variant.productId },
            select: { id: true, productCode: true },
          });
          
          if (product) {
            // Double-check productCode after fetching full product
            if (product.productCode && product.productCode.trim() !== '') {
              this.logger.log(`✅ Product ${product.id} has productCode ${product.productCode} (found after full fetch), allowing order`);
              continue;
            }
            
            // Try to find productCode from supplier products by matching product name
            this.logger.log(`Product ${product.id} has no productCode, attempting to find from supplier products...`);
            
            // First, try to get full product to check SKU
            const fullProduct = await this.prisma.product.findUnique({
              where: { id: variant.productId },
              select: { id: true, name: true, nameAr: true, sku: true, productCode: true },
            });
            
            // Try matching by SKU first (if product has SKU)
            let foundProductCode: string | null = null;
            if (fullProduct?.sku) {
              const supplierProductBySku = await this.prisma.supplierProduct.findFirst({
                where: { productCode: fullProduct.sku },
              });
              if (supplierProductBySku) {
                foundProductCode = supplierProductBySku.productCode;
                this.logger.log(`✅ Found productCode ${foundProductCode} by matching SKU: ${fullProduct.sku}`);
              }
            }
            
            // If not found by SKU, try name matching
            if (!foundProductCode) {
              foundProductCode = await this.findProductCodeFromSupplierProducts(
                fullProduct?.name || variant.product.name, 
                fullProduct?.nameAr || variant.product.nameAr
              );
            }
            
            if (foundProductCode) {
              // Update product with found productCode
              this.logger.log(`✅ Found productCode ${foundProductCode} for product ${product.id}, updating and allowing order`);
              await this.prisma.product.update({
                where: { id: product.id },
                data: { productCode: foundProductCode },
              });
              continue; // Allow order - will be fulfilled via supplier API
            }
            
            // If no productCode found but inventory is 0, check if this might be a digital product
            // For digital products, we can allow the order even without productCode (supplier API will handle it)
            // But first, try to sync inventory
            this.logger.log(`Attempting to sync inventory for product ${product.id}...`);
            await this.syncProductInventory(tenantId, product.id);
            
            // Re-check after sync
            const updatedVariant = await this.prisma.productVariant.findUnique({
              where: { id: item.variantId },
            });
            
            if (!updatedVariant) {
              this.logger.error(`Variant ${item.variantId} not found after sync`);
              return false;
            }
            
            if (updatedVariant.inventoryQuantity < item.quantity) {
              // Check if there are any supplier products available (might be a digital product)
              const hasSupplierProducts = await this.prisma.supplierProduct.count({
                where: { isActive: true, isAvailable: true },
              });
              
              // If inventory is insufficient and supplier products exist, allow order as fallback
              // The supplier API will be called, but may fail if productCode is missing
              if (hasSupplierProducts > 0) {
                this.logger.warn(`⚠️ Product ${product.id} ("${variant.product.name}") has insufficient inventory (${updatedVariant.inventoryQuantity} < ${item.quantity}) and no productCode match found, but ${hasSupplierProducts} supplier products exist.`);
                this.logger.warn(`⚠️ Allowing order as fallback - supplier API will be called but may fail if productCode is required.`);
                this.logger.warn(`⚠️ RECOMMENDATION: Go to Supplier Products Manager → "Auto-Fill Product Codes" to set productCode for "${variant.product.name}"`);
                continue; // Allow order - supplier API will be called, may fail if productCode is required
              }
              
              this.logger.error(`❌ Still insufficient inventory after sync: ${updatedVariant.inventoryQuantity} < ${item.quantity}`);
              this.logger.error(`❌ Product "${variant.product.name}" needs a productCode to use supplier API when inventory is insufficient.`);
              this.logger.error(`❌ Please: 1) Sync supplier products (Supplier Products Manager → "Sync Products"), 2) Use "Auto-Fill Product Codes" feature to set productCode`);
              return false;
            }
            
            this.logger.log(`✅ Inventory synced successfully: ${updatedVariant.inventoryQuantity} >= ${item.quantity}`);
          } else {
            this.logger.error(`Product ${variant.productId} not found`);
            return false;
          }
        } else {
          this.logger.log(`✅ Sufficient inventory: ${variant.inventoryQuantity} >= ${item.quantity}`);
        }
      } else {
        // Product without variant - check product-level inventory or allow if has productCode
        const product = await this.prisma.product.findFirst({
          where: {
            id: item.productId,
            tenantId,
          },
          select: {
            id: true,
            productCode: true,
            inventoryQuantity: true,
            name: true,
          },
        });

        if (!product) {
          this.logger.error(`Product ${item.productId} not found`);
          return false;
        }

        if (product.productCode && product.productCode.trim() !== '') {
          this.logger.log(`✅ Product ${product.id} (${product.name}) has productCode ${product.productCode}, allowing order (will be fulfilled via supplier API)`);
          continue;
        }

        // Check product-level inventory
        const productInventory = product.inventoryQuantity || 0;
        if (productInventory < item.quantity) {
          // Try to find productCode from supplier products
          this.logger.log(`Product ${product.id} has no productCode and insufficient inventory, attempting to find from supplier products...`);
          const foundProductCode = await this.findProductCodeFromSupplierProducts(product.name, null);
          
          if (foundProductCode) {
            // Update product with found productCode
            this.logger.log(`✅ Found productCode ${foundProductCode} for product ${product.id}, updating and allowing order`);
            await this.prisma.product.update({
              where: { id: product.id },
              data: { productCode: foundProductCode },
            });
            continue; // Allow order - will be fulfilled via supplier API
          }
          
          this.logger.error(`❌ Insufficient inventory for product ${product.id}: ${productInventory} < ${item.quantity} and no productCode found`);
          return false;
        }
      }
    }

    this.logger.log(`✅ All inventory checks passed`);
    return true;
  }

  /**
   * Find productCode from supplier products by matching product names
   * Uses simple name matching to find the best match
   */
  private async findProductCodeFromSupplierProducts(productName: string, productNameAr?: string | null): Promise<string | null> {
    try {
      const supplierProducts = await this.prisma.supplierProduct.findMany({
        where: { isActive: true, isAvailable: true },
      });

      this.logger.log(`Searching for productCode match among ${supplierProducts.length} supplier products for: "${productName}"`);

      if (supplierProducts.length === 0) {
        this.logger.warn(`No supplier products available in database`);
        return null;
      }

      let bestMatch: { productCode: string; score: number; name: string } | null = null;

      // Normalize product name (remove common prefixes/suffixes, amounts, etc.)
      const normalizeForMatching = (name: string): string => {
        return name.toLowerCase()
          .replace(/\$|€|£|¥|SAR|AED|USD|EUR|GBP|JPY|OMR|BHD|KWD|QAR/gi, '')
          .replace(/\d+\.?\d*/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };

      const normalizedProductName = normalizeForMatching(productName);
      const normalizedProductNameAr = productNameAr ? normalizeForMatching(productNameAr) : null;

      for (const sp of supplierProducts) {
        let score = 0;

        // Check English name match
        if (productName && sp.nameEn) {
          const name1 = normalizedProductName;
          const name2 = normalizeForMatching(sp.nameEn);
          
          // Exact match
          if (name1 === name2) {
            score = 1.0;
          }
          // Contains match (one contains the other)
          else if (name1.includes(name2) || name2.includes(name1)) {
            score = 0.8;
          }
          // Word overlap
          else {
            const words1 = name1.split(/\s+/).filter(w => w.length > 2); // Filter out short words
            const words2 = name2.split(/\s+/).filter(w => w.length > 2);
            if (words1.length > 0 && words2.length > 0) {
              const commonWords = words1.filter(w => words2.includes(w));
              if (commonWords.length > 0) {
                score = commonWords.length / Math.max(words1.length, words2.length);
              }
            }
          }
        }

        // Check Arabic name match
        if (normalizedProductNameAr && sp.nameAr) {
          const name1 = normalizedProductNameAr;
          const name2 = normalizeForMatching(sp.nameAr);
          
          if (name1 === name2) {
            score = Math.max(score, 1.0);
          } else if (name1.includes(name2) || name2.includes(name1)) {
            score = Math.max(score, 0.8);
          } else {
            const words1 = name1.split(/\s+/).filter(w => w.length > 2);
            const words2 = name2.split(/\s+/).filter(w => w.length > 2);
            if (words1.length > 0 && words2.length > 0) {
              const commonWords = words1.filter(w => words2.includes(w));
              if (commonWords.length > 0) {
                const wordScore = commonWords.length / Math.max(words1.length, words2.length);
                score = Math.max(score, wordScore);
              }
            }
          }
        }

        // Lower threshold to 0.3 to be more lenient
        if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { productCode: sp.productCode, score, name: sp.nameEn };
        }
      }

      if (bestMatch && bestMatch.score >= 0.3) {
        this.logger.log(`✅ Found productCode match: ${bestMatch.productCode} (${bestMatch.name}) with score ${bestMatch.score.toFixed(2)}`);
        return bestMatch.productCode;
      }

      // If we have a weak match (score > 0 but < 0.3), log it but don't use it
      if (bestMatch && bestMatch.score > 0 && bestMatch.score < 0.3) {
        this.logger.warn(`⚠️ Weak productCode match found for "${productName}": ${bestMatch.productCode} (${bestMatch.name}) with score ${bestMatch.score.toFixed(2)}. Threshold is 0.3, not using.`);
      }

      if (!bestMatch || bestMatch.score < 0.3) {
        this.logger.warn(`⚠️ No productCode match found for "${productName}" (best score: ${bestMatch?.score.toFixed(2) || '0.00'})`);
        this.logger.warn(`⚠️ RECOMMENDATION: Use "Auto-Fill Product Codes" feature in Supplier Products Manager to set productCode for this product`);
        return null;
      }

      return bestMatch.productCode;
    } catch (error: any) {
      this.logger.error(`Error finding productCode from supplier products: ${error.message}`);
      return null;
    }
  }
}



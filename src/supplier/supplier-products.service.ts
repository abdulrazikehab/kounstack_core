import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class SupplierProductsService {
  private readonly logger = new Logger(SupplierProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async syncSupplierProducts() {
    try {
      const apiKey = this.configService.get<string>('SUPPLIER_HUB_API_KEY');
      const baseUrl = 'https://supplier.saeaa.net/api/v1/products';
      
      this.logger.log(`Syncing from Supplier Hub: ${baseUrl}`);
      
      const headers: any = {};
      if (apiKey) {
        headers['X-API-KEY'] = apiKey;
      }

      let products: any;
      try {
        const response = await firstValueFrom(
            this.httpService.get(baseUrl, { headers, timeout: 30000 })
        );
        products = response.data;
      } catch (httpError: any) {
        this.logger.error(`HTTP Request failed: ${httpError.message}`, httpError.response?.data);
        if (httpError.response?.status === 401 || httpError.response?.status === 403) {
            throw new Error('Invalid API Key for Supplier Hub');
        }
        throw new Error(`Failed to fetch from Supplier Hub: ${httpError.message}`);
      }
      
      // Handle wrapped responses (e.g. { data: [...] }) which is common in many APIs
      if (!Array.isArray(products) && products?.data && Array.isArray(products.data)) {
        this.logger.log('Detected wrapped response format, extracting data array');
        products = products.data;
      }
      
      this.logger.log(`Received ${products?.length} products from Supplier Hub`);
      
      if (!Array.isArray(products)) {
        this.logger.error(`Invalid response format: expected array, got ${typeof products}. Response: ${JSON.stringify(products).substring(0, 200)}...`);
        // Check if it's an error object
        if (products && products.message) {
            throw new Error(`Supplier Hub API Error: ${products.message}`);
        }
        throw new Error('Invalid response format from supplier API (expected array)');
      }

      const synced: any[] = [];
      const errors: any[] = [];

      for (const p of products) {
        try {
          // Map fields with validation and defaults
          const supplierProduct = {
            productCode: p.product_code || '',
            nameEn: p.name_en || 'Unknown Product',
            nameAr: p.name_ar || null,
            currency: p.currency || 'SAR',
            faceValue: p.face_value != null ? p.face_value : 0,
            isActive: p.is_active !== undefined ? p.is_active : true,
            supplier: p.supplier || 'SUPPLIER_HUB',
            supplierProductId: p.supplier_product_id || p.product_code || `tmp-${Date.now()}`,
            buyPrice: p.buy_price != null ? p.buy_price : 0,
            isAvailable: p.is_available !== undefined ? p.is_available : true,
            lastSyncedAt: p.last_synced_at ? new Date(p.last_synced_at) : new Date(),
          };

          // Skip invalid entries
          if (!supplierProduct.productCode) {
            // Only warn if it's not just a completely empty object
            if (p.name_en || p.name_ar) {
                this.logger.warn(`Skipping product with missing product_code: ${p.name_en}`);
            }
            continue;
          }

          const upserted = await this.prisma.supplierProduct.upsert({
              where: {
                  productCode: supplierProduct.productCode 
              },
              update: supplierProduct,
              create: supplierProduct,
          });
          synced.push(upserted);
        } catch (itemError: any) {
          this.logger.error(`Failed to sync product ${p.product_code}: ${itemError.message}`);
          errors.push({ code: p.product_code, error: itemError.message });
        }
      }
        
      return { 
        success: true, 
        count: synced.length, 
        message: `Synced ${synced.length} products. Errors: ${errors.length}`, 
        products: synced,
        details: { synced: synced.length, failed: errors.length, errors }
      };

    } catch (error: any) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Failed to sync supplier products', error.stack);
      throw new ServiceUnavailableException(`Sync failed: ${error.message}`);
    }
  }

  /**
   * Normalize product name by removing amounts, currencies, locations, and extra whitespace
   */
  private normalizeProductName(name: string): string {
    if (!name) return '';
    
    let normalized = name.toLowerCase()
      // Remove currency symbols and codes
      .replace(/\$|€|£|¥|SAR|AED|USD|EUR|GBP|JPY|OMR|BHD|KWD|QAR/gi, '')
      // Remove amounts (numbers with optional decimals)
      // Removed: .replace(/\d+\.?\d*/g, '') - Keep numbers as they represent denominations for digital cards
      // Remove location indicators in parentheses
      .replace(/\([^)]*\)/g, '')
      // Remove common location words
      .replace(/\b(usa|uae|oman|bahrain|kuwait|qatar|saudi|store|shop)\b/gi, '')
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
    
    return normalized;
  }

  /**
   * Extract key product identifiers (gift card, wallet card, etc.)
   */
  private extractProductKeywords(name: string): string[] {
    if (!name) return [];
    
    const keywords: string[] = [];
    const lower = name.toLowerCase();
    
    // Common product type keywords
    const productTypes = ['gift card', 'wallet card', 'giftcard', 'walletcard', 'topup', 'top-up', 'voucher', 'prepaid'];
    for (const type of productTypes) {
      if (lower.includes(type)) {
        keywords.push(type.replace(/\s+/g, ''));
      }
    }
    
    // Extract brand/service names (common ones)
    const brands = ['apple', 'steam', 'google', 'playstation', 'xbox', 'nintendo', 'roblox', 'lulu', 'amazon', 'netflix', 'spotify'];
    for (const brand of brands) {
      if (lower.includes(brand)) {
        keywords.push(brand);
      }
    }
    
    return keywords;
  }

  /**
   * Calculate similarity using multiple strategies
   */
  private calculateSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    
    const str1 = s1.toLowerCase().trim();
    const str2 = s2.toLowerCase().trim();
    
    // Exact match
    if (str1 === str2) return 1.0;

    // Normalized match (without amounts, currencies, locations)
    const norm1 = this.normalizeProductName(str1);
    const norm2 = this.normalizeProductName(str2);
    
    if (norm1 && norm2) {
      if (norm1 === norm2) return 0.95;
      
      // Check if one contains the other (after normalization)
      if (norm1.includes(norm2) || norm2.includes(norm1)) {
        const longer = norm1.length > norm2.length ? norm1 : norm2;
        const shorter = norm1.length > norm2.length ? norm2 : norm1;
        if (shorter.length > 5) { // Only if shorter is meaningful
          return 0.85;
        }
      }
    }

    // Keyword-based matching
    const keywords1 = this.extractProductKeywords(str1);
    const keywords2 = this.extractProductKeywords(str2);
    
    if (keywords1.length > 0 && keywords2.length > 0) {
      const commonKeywords = keywords1.filter(k => keywords2.includes(k));
      if (commonKeywords.length > 0) {
        const keywordScore = commonKeywords.length / Math.max(keywords1.length, keywords2.length);
        // If we have matching keywords, boost the score
        if (keywordScore >= 0.5) {
          // Use token-based similarity for the rest
          const tokenScore = this.tokenBasedSimilarity(str1, str2);
          return Math.max(keywordScore * 0.6 + tokenScore * 0.4, tokenScore);
        }
      }
    }

    // Token-based similarity
    return this.tokenBasedSimilarity(str1, str2);
  }

  /**
   * Token-based similarity using word overlap
   */
  private tokenBasedSimilarity(s1: string, s2: string): number {
    const tokens1 = new Set(s1.split(/\s+/).filter(t => t.length > 2));
    const tokens2 = new Set(s2.split(/\s+/).filter(t => t.length > 2));
    
    if (tokens1.size === 0 && tokens2.size === 0) return 1.0;
    if (tokens1.size === 0 || tokens2.size === 0) return 0;
    
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);
    
    // Jaccard similarity
    const jaccard = intersection.size / union.size;
    
    // Also check for partial token matches (substring matching)
    let partialMatches = 0;
    for (const t1 of tokens1) {
      for (const t2 of tokens2) {
        if (t1.includes(t2) || t2.includes(t1)) {
          partialMatches++;
          break;
        }
      }
    }
    
    const partialScore = partialMatches / Math.max(tokens1.size, tokens2.size);
    
    // Combine Jaccard and partial matching
    return Math.max(jaccard, partialScore * 0.8);
  }

  async autoFillProductCodes(tenantId: string) {
    const supplierProducts = await this.prisma.supplierProduct.findMany();
    // Fetch products for the tenant
    const products = await this.prisma.product.findMany({
        where: { tenantId }
    });
    
    const results: any[] = [];
    
    for (const prod of products) {
        // Only suggest matches for products without productCode
        if (prod.productCode) continue; 
        
        let bestMatch: any = null;
        let highestScore = 0;
        
        for (const sp of supplierProducts) {
             // Check EN name
             const scoreEn = this.calculateSimilarity(prod.name, sp.nameEn);
             
             // Check AR name
             let scoreAr = 0;
             if (prod.nameAr && sp.nameAr) {
                 scoreAr = this.calculateSimilarity(prod.nameAr, sp.nameAr);
             }
             
             const score = Math.max(scoreEn, scoreAr);
             
             if (score > highestScore) {
                 highestScore = score;
                 bestMatch = sp;
             }
        }
        
        // Lower threshold to 0.5 for better matching, but prioritize higher scores
        // Return suggestions without applying them
        if (bestMatch && highestScore > 0.5) {
             // Calculate normalized names for comparison
             const normalizedProductName = this.normalizeProductName(prod.name);
             const normalizedSupplierName = this.normalizeProductName(bestMatch.nameEn);
             
             results.push({
                 productId: prod.id,
                 productName: prod.name,
                 productNameAr: prod.nameAr || null,
                 matchedSupplierProduct: bestMatch.nameEn,
                 matchedSupplierProductAr: bestMatch.nameAr || null,
                 productCode: bestMatch.productCode,
                 similarity: (highestScore * 100).toFixed(1) + '%',
                 // Additional comparison details
                 normalizedProductName: normalizedProductName,
                 normalizedSupplierName: normalizedSupplierName,
                 supplierProductCode: bestMatch.productCode,
                 supplierCurrency: bestMatch.currency || null,
                 supplierFaceValue: bestMatch.faceValue ? Number(bestMatch.faceValue) : null,
             });
        }
    }
    
    return results;
  }

  async acceptAutoFillMatches(tenantId: string, productIds: string[]) {
    const results: any[] = [];
    
    // Get the suggestions again to find the matches
    const suggestions = await this.autoFillProductCodes(tenantId);
    const suggestionMap = new Map(suggestions.map(s => [s.productId, s]));
    
    for (const productId of productIds) {
      const suggestion = suggestionMap.get(productId);
      if (!suggestion) {
        continue; // Skip if suggestion not found
      }
      
      // Apply the match
      await this.prisma.product.update({
        where: { id: productId },
        data: { productCode: suggestion.productCode }
      });
      
      results.push({
        productId,
        productName: suggestion.productName,
        productCode: suggestion.productCode,
        success: true
      });
    }
    
    return { success: true, count: results.length, results };
  }

  async clearAllProductCodes(tenantId: string) {
    const result = await this.prisma.product.updateMany({
      where: {
        tenantId,
        productCode: { not: null }
      },
      data: {
        productCode: null
      }
    });
    
    return { 
      success: true, 
      count: result.count, 
      message: `Cleared product codes for ${result.count} product(s)` 
    };
  }

  async findAll() {
    return this.prisma.supplierProduct.findMany({
        orderBy: { lastSyncedAt: 'desc' }
    });
  }
}

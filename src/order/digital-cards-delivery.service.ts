import { Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { CardInventoryService } from '../cards/card-inventory.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface DigitalCardDeliveryResult {
  serialNumbers: string[];
  serialNumbersByProduct: Record<string, Array<{ serialNumber: string; pin?: string }>>;
  deliveryOptions: string[];
  excelFileUrl?: string;
  textFileUrl?: string;
  pdfFileUrl?: string;
  error?: string;
  errorAr?: string;
  _isPendingReveal?: boolean;
}

@Injectable()
export class DigitalCardsDeliveryService {
  private readonly logger = new Logger(DigitalCardsDeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private cardInventoryService: CardInventoryService,
    private configService: ConfigService,
    private httpService: HttpService,
    private userService: UserService,
  ) {}

  /**
   * Process digital cards delivery for an order
   * Calls supplier API to get serial numbers and generates delivery files
   */
  async processDigitalCardsDelivery(
    tenantId: string,
    orderId: string,
    userId: string | null,
    orderItems: Array<{ productId: string; quantity: number; productName: string; price?: number }>,
    deliveryOptions?: string[], // Array of delivery options: 'text', 'excel', 'pdf', 'email', 'whatsapp', 'inventory'
    customerEmail?: string,
    customerName?: string,
    customerPhone?: string,
    orderNumber?: string,
    skipNotifications?: boolean,
  ): Promise<DigitalCardDeliveryResult | null> {
    this.logger.log(`🚀 ========== processDigitalCardsDelivery START ==========`);
    this.logger.log(`📋 Order: ${orderNumber || orderId}, Tenant: ${tenantId}, User: ${userId || 'guest'}`);
    this.logger.log(`📦 Order items count: ${orderItems.length}`);
    orderItems.forEach((item, idx) => {
      this.logger.log(`  Item ${idx + 1}: ${item.productName} (${item.productId}), Qty: ${item.quantity}`);
    });
    // Check if tenant is a digital cards store
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    this.logger.debug(`processDigitalCardsDelivery called: orderId=${orderId}, tenantId=${tenantId}, userId=${userId}, itemsCount=${orderItems.length}`);
    this.logger.log(`Processing digital cards delivery for order ${orderId}`);

    // Get order details
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        customerEmail: true,
        customerName: true,
        customerPhone: true,
        totalAmount: true,
        orderItems: {
          include: {
            product: {
              select: {
                productCode: true,
                price: true,
                priceExceed: true,
                brand: { select: { priceExceed: true } },
                categories: { include: { category: { select: { priceExceed: true } } } }
              },
            },
          },
        },
      },
    });

    if (!order) {
      this.logger.error(`Order ${orderId} not found`);
      return null;
    }

    const finalCustomerEmail = customerEmail || order.customerEmail;
    const finalCustomerName = customerName || order.customerName || 'Customer';
    const finalCustomerPhone = customerPhone || order.customerPhone;
    const finalOrderNumber = orderNumber || order.orderNumber;

    const allSerialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }> = [];
    const apiKey = this.configService.get<string>('SUPPLIER_HUB_API_KEY');
    const supplierApiUrl = 'https://supplier.saeaa.net/api/v1/orders';
    
    // Log API key status (without exposing the key)
    if (apiKey) {
      this.logger.log(`✅ SUPPLIER_HUB_API_KEY is configured (length: ${apiKey.length})`);
    } else {
      this.logger.error(`❌ SUPPLIER_HUB_API_KEY is NOT configured! Serial numbers cannot be fetched.`);
      this.logger.error(`Please set SUPPLIER_HUB_API_KEY in your .env file.`);
    }

    // Determine effectiveUserId early for inventory purposes
    // We ALWAYS try to resolve by email first if available, because the passed 'userId' 
    // might be from an external auth service (MySQL) while our inventory links to internal IDs (Postgres).
    if (finalCustomerEmail && userId) {
        await this.userService.ensureUserExists(userId, {
            email: finalCustomerEmail,
            tenantId: tenantId
        }).catch(err => this.logger.error(`Failed to ensure user exists for inventory: ${err.message}`));
    }

    let resolvedUserId: string | null = null;
    if (finalCustomerEmail) {
      try {
        const normalizedEmail = finalCustomerEmail.toLowerCase().trim();
        
        // Try to find user in the SAME tenant first (case-insensitive)
        const userByEmail = await this.prisma.user.findFirst({
          where: { 
            email: { equals: normalizedEmail, mode: 'insensitive' },
            tenantId: tenantId
          },
        });
        
        if (userByEmail) {
          resolvedUserId = userByEmail.id;
          this.logger.log(`✅ Resolved user by email in tenant ${tenantId}: ${resolvedUserId} (${userByEmail.email})`);
        } else {
          // Robust FALLBACK: Find user by email anywhere
          const userGlobal = await this.prisma.user.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          });
          
          if (userGlobal) {
            resolvedUserId = userGlobal.id;
            this.logger.log(`✅ Resolved user globally by email: ${resolvedUserId} (${userGlobal.email})`);
          }
        }
      } catch (error: any) {
        this.logger.error(`Failed to find user by email: ${error.message}`);
      }
    }
    
    // Fallback to the provided userId if we couldn't resolve by email
    let effectiveUserId: string | null = resolvedUserId || userId;
    
    this.logger.log(`👤 Final userId for inventory: ${effectiveUserId || 'NONE'} (original: ${userId || 'NONE'}, resolved: ${resolvedUserId || 'NONE'})`);

    // Track errors during processing
    const processingErrors: string[] = [];
    let hasProductCode = false;
    let hasApiKey = !!apiKey;

    // Process each order item - call supplier API or use local inventory
    this.logger.log(`🔄 Processing ${orderItems.length} order items for digital cards delivery`);
    for (const item of orderItems) {
      this.logger.log(`📦 Processing item: ${item.productName} (${item.productId}), quantity: ${item.quantity}`);
      
      const orderItem = order.orderItems.find(oi => oi.productId === item.productId);
      const product = orderItem?.product;

      // 1. Try to fulfill from LOCAL INVENTORY first
      // We prioritize local inventory if available
      try {
        this.logger.log(`🔍 Checking local inventory for product ${item.productName} (id: ${item.productId})...`);
        const reservedIds = await this.cardInventoryService.reserveCards(item.productId, item.quantity, orderId);
        
        if (reservedIds && reservedIds.length > 0) {
           this.logger.log(`✅ Reserved ${reservedIds.length} cards from LOCAL inventory`);
           
           // Mark as SOLD
           await this.prisma.cardInventory.updateMany({
             where: { id: { in: reservedIds } },
             data: {
               status: 'SOLD',
               soldAt: new Date(),
               soldToUserId: effectiveUserId || null,
               orderId,
             },
           });
           
           // Fetch card details to add to results
           const cards = await this.prisma.cardInventory.findMany({ 
             where: { id: { in: reservedIds } } 
           });
           
           cards.forEach(c => {
             allSerialNumbers.push({
               productName: item.productName,
               serialNumber: c.cardCode,
               pin: c.cardPin || undefined
             });
           });
           
           this.logger.log(`✅ Fulfilled ${cards.length} cards from LOCAL inventory for ${item.productName}`);
           continue; // Skip Supplier API for this item since we fulfilled it locally
        }
      } catch (localError: any) {
        // If not enough inventory locally, reserveCards throws error. 
        // We log and proceed to Supplier API fallback.
        this.logger.log(`ℹ️ Local inventory check for ${item.productName}: ${localError.message}. Proceeding to Supplier API.`);
      }

      // 2. Get product with productCode
      let productCode: string | null = product?.productCode || null;
      let productSku: string | null = product?.sku || null;
      // Default to item name, but prefer canonical English name from DB if available
      let productNameEn = item.productName;

      if (product) {
        this.logger.log(`✅ Found product details from order: ${productCode}`);
        if (product.productCode) {
           productCode = product.productCode;
        }
      } else {
        // Fallback for safety (should not happen since we fetch with order)
        this.logger.log(`🔍 Fetching productCode from database for product ${item.productId}...`);
        const dbProduct = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { 
            productCode: true, 
            name: true, 
            sku: true,
            priceExceed: true,
            brand: { select: { priceExceed: true } },
            categories: { include: { category: { select: { priceExceed: true } } } }
          },
        });
        if (dbProduct) {
          productCode = dbProduct.productCode;
          productSku = dbProduct.sku;
          if (dbProduct.name) productNameEn = dbProduct.name;
        }
      }

      // Try to use SKU as fallback if productCode is not set
      if ((!productCode || productCode.trim() === '') && productSku && productSku.trim() !== '') {
        this.logger.warn(`⚠️ Product ${productNameEn} does not have productCode, but has SKU: ${productSku}. Using SKU as fallback.`);
        productCode = productSku;
        this.logger.log(`✅ Using SKU as productCode: ${productCode}`);
      } else if (!productCode || productCode.trim() === '') {
        // Last resort: Try to find productCode from SupplierProduct table by matching product name
        this.logger.log(`🔍 Product ${productNameEn} has no productCode or SKU. Attempting to find from SupplierProduct table...`);
        try {
          const supplierProducts = await this.prisma.supplierProduct.findMany({
            where: { isActive: true, isAvailable: true },
            select: { productCode: true, nameEn: true, nameAr: true },
          });
          
          // Simple name matching
          const normalizeName = (name: string) => name.toLowerCase()
            .replace(/\$|€|£|¥|SAR|AED|USD|EUR|GBP|JPY|OMR|BHD|KWD|QAR/gi, '')
            // Removed: .replace(/\d+\.?\d*/g, '') - Keep numbers as they represent denominations
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          
          const normalizedProductName = normalizeName(productNameEn);
          let bestMatch: { productCode: string; score: number } | null = null;
          
          for (const sp of supplierProducts) {
            const normalizedSpName = normalizeName(sp.nameEn || '');
            const normalizedSpNameAr = sp.nameAr ? normalizeName(sp.nameAr) : '';
            
            // Exact match
            if (normalizedProductName === normalizedSpName || normalizedProductName === normalizedSpNameAr) {
              bestMatch = { productCode: sp.productCode, score: 1.0 };
              break;
            }
            
            // Partial match
            if (normalizedProductName.includes(normalizedSpName) || normalizedSpName.includes(normalizedProductName) ||
                normalizedProductName.includes(normalizedSpNameAr) || normalizedSpNameAr.includes(normalizedProductName)) {
              const score = Math.max(
                normalizedProductName.length / Math.max(normalizedSpName.length, normalizedProductName.length),
                normalizedSpName.length / Math.max(normalizedSpName.length, normalizedProductName.length)
              );
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { productCode: sp.productCode, score };
              }
            }
          }
          
          if (bestMatch && bestMatch.score >= 0.5) {
            productCode = bestMatch.productCode;
            this.logger.log(`✅ Found productCode from SupplierProduct table: ${productCode} (match score: ${bestMatch.score.toFixed(2)})`);
            // Optionally update the product with this productCode for future use
            try {
              await this.prisma.product.update({
                where: { id: item.productId },
                data: { productCode: productCode },
              });
              this.logger.log(`✅ Updated product ${item.productId} with productCode ${productCode} for future use`);
            } catch (updateError: any) {
              this.logger.warn(`⚠️ Failed to update product with productCode: ${updateError.message}`);
            }
          } else {
            this.logger.error(`❌ Product ${item.productId} (${productNameEn}) does NOT have a productCode, SKU, or matching SupplierProduct!`);
            processingErrors.push(`Product "${productNameEn}" (ID: ${item.productId}) does not have a productCode or SKU set`);
            continue;
          }
        } catch (lookupError: any) {
          this.logger.error(`❌ Failed to lookup productCode from SupplierProduct: ${lookupError.message}`);
          processingErrors.push(`Product "${productNameEn}" (ID: ${item.productId}) does not have a productCode or SKU set`);
          continue;
        }
      }

      // GLOBAL CHECK: If we have a valid productCode from ANY source, set the flag
      if (productCode && productCode.trim() !== '') {
        hasProductCode = true;
      } else {
        this.logger.error(`❌ Product ${item.productId} (${productNameEn}) does not have a productCode or SKU, skipping supplier API call`);
        processingErrors.push(`Product "${productNameEn}" (ID: ${item.productId}) does not have a productCode or SKU set`);
        continue;
      }
      
      this.logger.log(`✅ Product ${productNameEn} has productCode: ${productCode}, proceeding with supplier API call`);

      const itemPrice = Number(orderItem?.price || item.price || orderItem?.product?.price || 0);
      const currency = orderItem?.product?.priceCurrency || orderItem?.product?.displayCurrency || 'SAR';

      
      // Fetch dynamic supplier priority from product settings
      const linkedSuppliers = await this.prisma.productSupplier.findMany({
        where: { productId: item.productId },
        include: { supplier: true },
        orderBy: [
          { isPrimary: 'desc' }, // Primary supplier first
          { createdAt: 'asc' }   // Then by creation date
        ]
      });

      // Extract provider codes (e.g., "WUPEX", "ONECARD")
      const getInferredProvider = (s: any) => {
        if (s.provider && s.provider.trim() !== '') return s.provider;
        // Fallback: Infer from name if provider field is null/empty
        const name = (s.name || '').toUpperCase();
        if (name.includes('WUPEX')) return 'WUPEX';
        if (name.includes('ONECARD') || name.includes('1CARD')) return 'ONECARD';
        if (name.includes('BAMBOO')) return 'BAMBOO';
        if (name.includes('LIKE')) return 'LIKE_CARD';
        if (name.includes('BITAQATY')) return 'BITAQATY';
        if (name.includes('MINTAR')) return 'MINTAR';
        return null;
      };

      // Determine effective priceExceed (Inheritance: Product > Brand > Category)
      let effectivePriceExceed = false;
      if (product) {
        if (product.priceExceed) {
          effectivePriceExceed = true;
        } else if (product.brand?.priceExceed) {
          effectivePriceExceed = true;
        } else if (product.categories?.some(pc => pc.category?.priceExceed)) {
          effectivePriceExceed = true;
        }
      }

      let supplierPriority: Array<{ name: string; product_code: string; priceExceed: boolean }> = linkedSuppliers
        .map(ps => {
          const name = getInferredProvider(ps.supplier);
          if (!name) return null;
          return {
            name: name.toUpperCase(),
            product_code: ps.supplierProductCode || productCode,
            priceExceed: effectivePriceExceed,
          };
        })
        .filter((p): p is { name: string; product_code: string; priceExceed: boolean } => !!p);
      
      // Fallback: If no suppliers linked to product, use ALL active suppliers
      const missingSuppliers = supplierPriority.length === 0;
      if (missingSuppliers) {
        this.logger.warn(`⚠️ No suppliers explicitly linked to product ${productCode} (${productNameEn}). Falling back to ALL active suppliers.`);
        
        const allSuppliers = await this.prisma.supplier.findMany({
          where: { isActive: true, tenantId: order.tenantId },
        });
        
        supplierPriority = allSuppliers
          .map(s => {
            const name = getInferredProvider(s);
            if (!name) return null;
            return {
              name: name.toUpperCase(),
              product_code: productCode,
              priceExceed: effectivePriceExceed,
            };
          })
          .filter((p): p is { name: string; product_code: string; priceExceed: boolean } => !!p);

        if (supplierPriority.length === 0) {
           this.logger.error(`❌ No active suppliers found in system for tenant ${order.tenantId}! Checking product code heuristics...`);
            // Heuristic: Infer supplier from product code prefix
            const upperCode = productCode.toUpperCase();
            let inferredName: string | null = null;
            if (upperCode.startsWith('WUPEX')) {
              inferredName = 'WUPEX';
            } else if (upperCode.startsWith('ONECARD') || upperCode.startsWith('1CARD')) {
              inferredName = 'ONECARD';
            } else if (upperCode.startsWith('LIKE')) {
              inferredName = 'LIKE_CARD';
            } else if (upperCode.startsWith('BAMBOO')) {
              inferredName = 'BAMBOO';
            } else if (upperCode.startsWith('BITAQATY')) {
              inferredName = 'BITAQATY';
            }

            if (inferredName) {
              supplierPriority.push({ 
                name: inferredName, 
                product_code: productCode,
                priceExceed: effectivePriceExceed
              });
              this.logger.log(`✅ Inferred '${inferredName}' supplier from product code ${productCode}`);
            }
           
           if (supplierPriority.length === 0) {
             this.logger.warn(`⚠️ Could not infer supplier from product code. API call requires at least one supplier.`);
           }
        } else {
           this.logger.log(`✅ Using fallback supplier priority (all active): ${JSON.stringify(supplierPriority)}`);
        }
      } else {
        this.logger.log(`✅ Using configured supplier priority for ${productCode}: ${JSON.stringify(supplierPriority)}`);
      }

      try {
        // Call supplier API to get serial numbers
        this.logger.log(`Calling supplier API for product ${productCode}, quantity ${item.quantity}`);
        this.logger.log(`API URL: ${supplierApiUrl}`);
        
        // Use timestamp format similar to example: KAWN-ORDER-{{$timestamp}}
        // Add random suffix to ensure uniqueness
        const orderRef = `KAWN-ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        const requestBody = {
          order_ref: orderRef,
          product_code: productCode,
          quantity: item.quantity,
          sell_price: itemPrice * item.quantity,
          currency: currency,
          supplier_priority: supplierPriority,
          metadata: {
            customer_name: finalCustomerName,
            customer_email: finalCustomerEmail,
            notes: `Order ${finalOrderNumber} - ${productNameEn}`,
            ...(finalCustomerPhone && { customer_phone: finalCustomerPhone }),
          },
        };

        const headers: any = {
          'Content-Type': 'application/json',
        };
        if (apiKey) {
          headers['X-API-KEY'] = apiKey;
          this.logger.log(`Using API key: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`);
        } else {
          this.logger.warn(`⚠️ SUPPLIER_HUB_API_KEY is not configured! API call may fail.`);
        }

        this.logger.log(`Request Body: ${JSON.stringify(requestBody, null, 2)}`);

        const response = await firstValueFrom(
          this.httpService.post(supplierApiUrl, requestBody, { headers }),
        );

        this.logger.log(`Supplier API response status: ${response.status}`);
        let responseData = response.data;
        this.logger.log(`📦 Supplier API response data: ${JSON.stringify(responseData, null, 2)}`);
        
        // If deliverables has type/key but no value, try to get order details via GET API
        if (responseData.deliverables && Array.isArray(responseData.deliverables)) {
          const hasTypeKeyButNoValue = responseData.deliverables.some((d: any) => 
            d.type === 'serial' && d.key && !d.value
          );
          
          if (hasTypeKeyButNoValue && responseData.order_ref) {
            this.logger.log(`🔄 Deliverables has type/key but no value. Attempting to fetch order details for ${responseData.order_ref}...`);
            
            try {
              // Try to get order details via GET API
              const getOrderUrl = `${supplierApiUrl}/${responseData.order_ref}`;
              const getOrderHeaders: any = {
                'Content-Type': 'application/json',
              };
              if (apiKey) {
                getOrderHeaders['X-API-KEY'] = apiKey;
              }
              
              this.logger.log(`📡 Calling GET ${getOrderUrl} to fetch order details...`);
              const orderDetailsResponse = await firstValueFrom(
                this.httpService.get(getOrderUrl, { headers: getOrderHeaders }),
              );
              
              this.logger.log(`✅ Order details response: ${JSON.stringify(orderDetailsResponse.data, null, 2)}`);
              
              // Merge order details with original response
              if (orderDetailsResponse.data && orderDetailsResponse.data.deliverables) {
                responseData = {
                  ...responseData,
                  deliverables: orderDetailsResponse.data.deliverables,
                };
                this.logger.log(`✅ Updated responseData with order details deliverables`);
              }
            } catch (getOrderError: any) {
              this.logger.warn(`⚠️ Failed to fetch order details: ${getOrderError.message}`);
              // Continue with original response
            }
          }
        }

        // Helper function to find serials recursively
        const findSerialsInObject = (obj: any): any[] => {
            if (!obj) return [];
            if (Array.isArray(obj)) return obj;
            
            // Common keys for serial number lists (including 'deliverables' for KAWN API)
            const keysToCheck = ['deliverables', 'serial_numbers', 'serials', 'data', 'codes', 'cards', 'items'];
            
            for (const key of keysToCheck) {
                if (obj[key] && Array.isArray(obj[key]) && obj[key].length > 0) {
                    this.logger.log(`✅ Found array in key '${key}' with ${obj[key].length} items`);
                    return obj[key];
                }
                // If data is nested object, drill down
                if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                     const result = findSerialsInObject(obj[key]);
                     if (result.length > 0) return result;
                }
            }
            return [];
        };

        let serialNumbers: any[] = findSerialsInObject(responseData);
        
        // SPECIAL HANDLING: If deliverables contains objects with type/key but no value,
        // the actual serial numbers might be in a different field or need a follow-up API call
        if (responseData.deliverables && Array.isArray(responseData.deliverables)) {
          this.logger.log(`📋 Found deliverables array with ${responseData.deliverables.length} items`);
          responseData.deliverables.forEach((deliverable: any, idx: number) => {
            this.logger.log(`  Deliverable ${idx + 1}: ${JSON.stringify(deliverable)}`);
          });
          
          // Check if deliverables has type/key but no value - might need to check other fields
          const hasTypeKeyButNoValue = responseData.deliverables.some((d: any) => 
            d.type === 'serial' && d.key && !d.value
          );
          
          if (hasTypeKeyButNoValue) {
            this.logger.warn(`⚠️ Deliverables has type/key but no value field. Checking for serial numbers in other response fields...`);
            
            // Check for serial numbers in other common fields
            const alternativeFields = ['serial_numbers', 'serials', 'codes', 'cards', 'data', 'result', 'response'];
            for (const field of alternativeFields) {
              if (responseData[field] && Array.isArray(responseData[field]) && responseData[field].length > 0) {
                this.logger.log(`✅ Found serial numbers in alternative field '${field}'`);
                serialNumbers = responseData[field];
                break;
              }
            }
            
            // If still no serials found, check if the API returns them in a nested structure
            // Some APIs return serials in responseData.data.deliverables[0].value or similar
            if (serialNumbers.length === 0 && responseData.data) {
              const nestedSerials = findSerialsInObject(responseData.data);
              if (nestedSerials.length > 0) {
                this.logger.log(`✅ Found serial numbers in nested data structure`);
                serialNumbers = nestedSerials;
              }
            }
          }
        }
        
        if (serialNumbers.length === 0) {
           // Last resort: check if any value in the object is an array
           for (const key in responseData) {
               if (Array.isArray(responseData[key]) && responseData[key].length > 0) {
                   serialNumbers = responseData[key];
                   this.logger.warn(`⚠️ Found array in unexpected key '${key}' with ${responseData[key].length} items`);
                   break;
               }
           }
        }
        
        this.logger.log(`📊 Extracted ${serialNumbers.length} potential serial numbers/objects from response`);
        
        if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
          this.logger.error(`❌ No serial numbers returned from supplier API for product ${productCode}`);
          this.logger.error(`❌ Response structure: ${JSON.stringify(Object.keys(responseData))}`);
          // Check for error message in response
          if (responseData?.message || responseData?.error) {
             this.logger.error(`API returned error message: ${responseData.message || responseData.error}`);
          }
          // Log full response for debugging
          this.logger.error(`Full API response: ${JSON.stringify(responseData, null, 2)}`);
          processingErrors.push(`Supplier API returned 0 serial numbers for product ${productCode}${missingSuppliers ? ' (No suppliers linked - please configure suppliers for this product)' : ''}`);
          continue;
        }

        // If this looks like KAWN deliverables format (type/key/value), pair SERIAL+PIN by matching serial numbers to avoid duplicates
        const looksLikeDeliverables =
          Array.isArray(serialNumbers) &&
          serialNumbers.length > 0 &&
          typeof serialNumbers[0] === 'object' &&
          (serialNumbers[0]?.type === 'serial' || serialNumbers[0]?.type === 'pin') &&
          typeof serialNumbers[0]?.key === 'string';

        if (looksLikeDeliverables) {
          this.logger.log(`🧩 Detected deliverables format; pairing serial/pin by matching values to avoid duplicates...`);
          const paired: Map<string, { serialNumber?: string; pin?: string }> = new Map();

          // First pass: collect all serial entries
          for (const d of serialNumbers) {
            if (d.type === 'serial') {
              const serialValue = d.value || d.serial || d.serial_number || d.code || d.cardCode;
              const pinValue = d.extra?.pin || d.extra?.pin_code;
              
              if (serialValue) {
                const serialStr = String(serialValue);
                // Use serial number as unique key to avoid duplicates
                if (!paired.has(serialStr)) {
                  paired.set(serialStr, {
                    serialNumber: serialStr,
                    pin: pinValue ? String(pinValue) : undefined,
                  });
                  this.logger.log(`✅ Paired from serial entry: serial=${serialStr}, pin=${pinValue || 'N/A'}`);
                } else {
                  // Update existing entry with PIN if not already set
                  const existing = paired.get(serialStr)!;
                  if (!existing.pin && pinValue) {
                    existing.pin = String(pinValue);
                    this.logger.log(`✅ Updated PIN for existing serial: serial=${serialStr}, pin=${pinValue}`);
                  }
                }
              }
            }
          }

          // Second pass: collect PIN entries and match by serialNumber in extra
          for (const d of serialNumbers) {
            if (d.type === 'pin') {
              const pinValue = d.value || d.pin || d.pin_code || d.secret || d.cardPin;
              const serialValue = d.extra?.serialNumber || d.extra?.serial || d.extra?.code;
              
              if (pinValue && serialValue) {
                const serialStr = String(serialValue);
                const pinStr = String(pinValue);
                
                if (paired.has(serialStr)) {
                  // Update existing entry with PIN
                  const existing = paired.get(serialStr)!;
                  if (!existing.pin) {
                    existing.pin = pinStr;
                    this.logger.log(`✅ Updated PIN from pin entry: serial=${serialStr}, pin=${pinStr}`);
                  }
                } else {
                  // New entry (PIN-only or serial not found in first pass)
                  paired.set(serialStr, {
                    serialNumber: serialStr,
                    pin: pinStr,
                  });
                  this.logger.log(`✅ Paired from pin entry: serial=${serialStr}, pin=${pinStr}`);
                }
              } else if (pinValue && !serialValue) {
                // PIN-only entry (no serial in extra)
                const pinStr = String(pinValue);
                // Use PIN as key for PIN-only entries
                if (!paired.has(`PIN_ONLY_${pinStr}`)) {
                  paired.set(`PIN_ONLY_${pinStr}`, {
                    serialNumber: '', // Empty for PIN-only
                    pin: pinStr,
                  });
                  this.logger.log(`✅ Added PIN-only entry: pin=${pinStr}`);
                }
              }
            }
          }

          serialNumbers = Array.from(paired.values())
            .filter(v => (v.serialNumber && v.serialNumber.trim() !== '') || (v.pin && v.pin.trim() !== ''));

          this.logger.log(`✅ Paired deliverables into ${serialNumbers.length} unique card entries`);
        }

        // Store serial numbers
        this.logger.log(`🔄 Processing ${serialNumbers.length} serial number objects...`);
        for (let idx = 0; idx < serialNumbers.length; idx++) {
          const serial = serialNumbers[idx];
          this.logger.log(`  Processing serial object ${idx + 1}/${serialNumbers.length}: ${JSON.stringify(serial)}`);
          
          // Check if this is already a paired object (has serialNumber property directly, no type field)
          if (serial.serialNumber !== undefined || serial.pin !== undefined) {
            // Already paired format: {serialNumber: "...", pin: "..."}
            const serialStr = serial.serialNumber ? String(serial.serialNumber).trim() : '';
            const pinStr = serial.pin ? String(serial.pin).trim() : undefined;
            
            if (serialStr && serialStr !== '') {
              allSerialNumbers.push({
                productName: item.productName,
                serialNumber: serialStr,
                pin: pinStr,
              });
              this.logger.log(`✅ Using paired format: serialNumber=${serialStr}, pin=${pinStr || 'N/A'}`);
              continue;
            } else if (pinStr && pinStr !== '') {
              // PIN-only product
              allSerialNumbers.push({
                productName: item.productName,
                serialNumber: '', // Empty serial for PIN-only
                pin: pinStr,
              });
              this.logger.log(`✅ Using paired format (PIN-only): pin=${pinStr}`);
              continue;
            }
          }
          
          // Handle KAWN API format: { type: "serial", key: "serialNumber", value: "...", extra: { pin: "...", ... } }
          let serialNumber: string | undefined;
          let pin: string | undefined;
          
          // Case 1: KAWN API format with value field
          if (serial.type === 'serial' && serial.value) {
            serialNumber = serial.value;
            pin = serial.extra?.pin || serial.extra?.pin_code || undefined;
            this.logger.log(`✅ Found serial in KAWN format: serialNumber=${serialNumber}, pin=${pin || 'N/A'}`);
          } 
          // Case 2: KAWN API format with type/key but NO value (might be in different structure)
          else if (serial.type === 'serial' && serial.key && !serial.value) {
            this.logger.warn(`⚠️ Serial object has type/key but no value. Key: ${serial.key}`);
            // Try to find value in other fields or nested structure
            serialNumber = serial[serial.key] || serial.value || serial.serial || serial.serial_number || serial.code;
            pin = serial.pin || serial.extra?.pin || undefined;
            
            if (!serialNumber) {
              this.logger.error(`❌ Cannot extract serial number from object: ${JSON.stringify(serial)}`);
              // Skip this item - might need follow-up API call
              continue;
            }
            this.logger.log(`✅ Extracted serial from alternative structure: serialNumber=${serialNumber}, pin=${pin || 'N/A'}`);
          }
          // Case 3: PIN object with serial in extra
          else if (serial.type === 'pin' && serial.extra?.serialNumber) {
            serialNumber = serial.extra.serialNumber;
            pin = serial.value || serial.extra?.pin || undefined;
            this.logger.log(`✅ Found serial from PIN object: serialNumber=${serialNumber}, pin=${pin || 'N/A'}`);
          } 
          // Case 4: Handle various field names for serial number and pin (legacy formats)
          else {
            serialNumber = serial.serial || serial.serial_number || serial.code || serial.cardCode || serial.pin_code || serial.Serial || serial.Code || serial.value || serial.sn || serial.cardNumber;
            pin = serial.pin || serial.pin_code || serial.secret || serial.cardPin || serial.Pin || serial.extra?.pin || serial.pincode || serial.password || undefined;
            
            if (serialNumber) {
              this.logger.log(`✅ Extracted serial from legacy format: serialNumber=${serialNumber}, pin=${pin || 'N/A'}`);
            }
          }
          
          // If the serial object is just a string, treat it as the serial number
          if (typeof serial === 'string' || typeof serial === 'number') {
             allSerialNumbers.push({
                productName: item.productName,
                serialNumber: String(serial),
                pin: undefined
             });
          } else {
              // Ensure we have a valid serial number string
              let serialStr = serialNumber ? String(serialNumber) : 'UNKNOWN';
              let pinStr: string | undefined = pin ? String(pin) : (serial.pin ? String(serial.pin) : undefined);

              // Normalization: if product returns PIN-only and it landed in "serialNumber", move it to PIN
              if ((!pinStr || pinStr.trim() === '') && serialStr && serialStr.toUpperCase().startsWith('PIN-')) {
                pinStr = serialStr;
                serialStr = '';
              }

              allSerialNumbers.push({
                productName: item.productName,
                serialNumber: serialStr,
                pin: pinStr ? String(pinStr) : undefined,
              });
          }

          // Store in database for tracking (using the extracted values)
          // Get the final serial number (from allSerialNumbers array we just added to)
          const lastAdded = allSerialNumbers[allSerialNumbers.length - 1];
          const serialStr = lastAdded?.serialNumber || (typeof serial === 'string' || typeof serial === 'number' ? String(serial) : String(serialNumber || ''));
          const pinStr = lastAdded?.pin || (pin ? String(pin) : null);
          
          if (!serialStr || serialStr === 'UNKNOWN' || serialStr === '[object Object]' || serialStr.trim() === '') {
             this.logger.warn(`Invalid serial number extracted: ${JSON.stringify(serial)}, serialStr=${serialStr}`);
             // Remove the invalid entry we just added
             allSerialNumbers.pop();
             continue;
          }

          // Save card to inventory (even if userId is null - will be linked later)
          // This ensures cards are always saved, and saveToCustomerInventory will update them if needed
          try {
            await this.prisma.cardInventory.create({
              data: {
                tenantId,
                productId: item.productId,
                cardCode: serialStr,
                cardPin: pinStr,
                status: 'SOLD',
                soldAt: new Date(),
                soldToUserId: effectiveUserId || userId || null, 
              },
            });
            this.logger.log(`💾 Saved card ${serialStr} to inventory (userId: ${effectiveUserId || userId || 'NULL'})`);
          } catch (dbError: any) {
             if (dbError.code !== 'P2002') { // Ignore unique constraint errors (duplicate serials)
                this.logger.warn(`Failed to store serial number in database: ${dbError.message}`);
             } else {
                this.logger.log(`Card ${serialStr} already exists in inventory (duplicate), will be updated by saveToCustomerInventory`);
             }
          }
        }

        this.logger.log(`Retrieved ${serialNumbers.length} serial numbers from supplier API for ${item.productName}`);
      } catch (error: any) {
        this.logger.error(`Failed to call supplier API for product ${productCode}:`, error.message);
        let errorDetails = error.message;
        
        if (error.response) {
            this.logger.error(`API Error Response Status: ${error.response.status}`);
            this.logger.error(`API Error Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
            
            if (error.response.data && typeof error.response.data === 'object') {
              const data = error.response.data;
              errorDetails = data.message || data.error || data.detail || JSON.stringify(data);
            }
        }

        // Self-healing logic: Attempt to find better product code if API validation failed
        if (
          (errorDetails.includes('Validation failed') || 
           error.response?.status === 400 || 
           error.response?.status === 404 || 
           error.response?.status === 422)
        ) {
          try {
             this.logger.warn(`⚠️ API call failed for ${productCode}. Attempting to self-heal product code for "${item.productName}"...`);
             const betterCode = await this.lookupSupplierProductCode(item.productName);
             
             if (betterCode && betterCode !== productCode) {
                 this.logger.log(`✅ FOUND BETTER CODE: ${betterCode}. Updating product ${item.productId} in database...`);
                 await this.prisma.product.update({
                     where: { id: item.productId },
                     data: { productCode: betterCode }
                 });
                 this.logger.log(`✅ Product productCode updated to ${betterCode}. Please retry the order.`);
                 // Append helpful message to errorDetails so user knows to retry
                 errorDetails += ` (System auto-corrected product code to ${betterCode}. Please retry.)`;
             }
          } catch (healError: any) {
             this.logger.error(`Failed during self-healing attempt: ${healError.message}`);
          }
        }
        
        // We do NOT filter/throw here so other items can still be processed
        this.logger.warn(`Skipping product ${productCode} due to API failure: ${errorDetails}`);
        processingErrors.push(`Supplier API call failed for ${productCode}: ${errorDetails}${missingSuppliers ? ' (No suppliers linked - please configure suppliers)' : ''}`);
      }
    }

    if (allSerialNumbers.length === 0) {
      this.logger.warn(`No cards to deliver for order ${orderId}`);
      
      // Build error message based on what we found
      let errorMessage = 'No serial numbers were retrieved. ';
      let errorMessageAr = 'لم يتم استرجاع الأرقام التسلسلية. ';
      
      if (!hasApiKey) {
        errorMessage += 'SUPPLIER_HUB_API_KEY is not configured. ';
        errorMessageAr += 'SUPPLIER_HUB_API_KEY غير مضبوط. ';
      }
      
      if (!hasProductCode && processingErrors.length === 0) {
        errorMessage += 'Products do not have productCode set. ';
        errorMessageAr += 'المنتجات لا تحتوي على productCode. ';
      }
      
      if (processingErrors.length > 0) {
        errorMessage += `Issues: ${processingErrors.join('; ')}. `;
        errorMessageAr += `مشاكل: ${processingErrors.join('؛ ')}. `;
      }
      
      errorMessage += 'Please check product configuration and API settings.';
      errorMessageAr += 'يرجى التحقق من إعدادات المنتج وواجهة برمجة التطبيقات.';
      
      // Return error information instead of null
      this.logger.error(`❌ Returning error result for order ${orderId}: ${errorMessage}`);
      const errorResult = {
        serialNumbers: [],
        serialNumbersByProduct: {},
        deliveryOptions: deliveryOptions || [],
        error: errorMessage,
        errorAr: errorMessageAr,
      };
      this.logger.log(`📋 Error result object:`, JSON.stringify(errorResult, null, 2));
      return errorResult;
    }

    // Process delivery options
    // Default to 'inventory' if user is logged in, otherwise 'text'
    let deliveryOptionsList = deliveryOptions || [];
    if (deliveryOptionsList.length === 0) {
      if (effectiveUserId || userId) {
        deliveryOptionsList = ['inventory', 'text'];
      } else {
        deliveryOptionsList = ['text'];
      }
      this.logger.log(`ℹ️ No delivery options provided, using defaults: ${JSON.stringify(deliveryOptionsList)}`);
    }

    // Force inventory option if we have an effective user, even if not explicitly requested
    // This ensures that if we identified the user (e.g. by email), the cards are always linked to their inventory
    if (effectiveUserId && !deliveryOptionsList.includes('inventory')) {
        deliveryOptionsList.push('inventory');
        this.logger.log(`ℹ️ User identified (${effectiveUserId}), forcing 'inventory' to delivery options to ensure persistence`);
    }
    
    // Only save to inventory if the inventory delivery option is explicitly selected
    const inventoryOptionSelected = deliveryOptionsList.includes('inventory');
    
    this.logger.log(`🔍 Inventory save check: inventoryOptionSelected=${inventoryOptionSelected}, effectiveUserId=${effectiveUserId || 'NONE'}, deliveryOptionsList=${JSON.stringify(deliveryOptionsList)}`);
    
    if (inventoryOptionSelected) {
      if (effectiveUserId) {
        this.logger.log(`💾 Saving ${allSerialNumbers.length} serial numbers to customer inventory for order ${orderId} (user: ${effectiveUserId}, inventory option: SELECTED)`);
        this.logger.log(`💾 Serial numbers to save: ${allSerialNumbers.length} items`);
        
        // CRITICAL DEBUG: Log to file (using relative path to avoid hardcoded Windows paths)
        try {
          const fs = require('fs');
          const debugData = {
            timestamp: new Date().toISOString(),
            orderId,
            tenantId,
            effectiveUserId,
            serialNumbers: allSerialNumbers,
            deliveryOptionsList
          };
          fs.appendFileSync('delivery_debug.log', JSON.stringify(debugData, null, 2) + '\n---\n');
        } catch (e) {}

        try {
          if (!skipNotifications) {
            await this.saveToCustomerInventory(tenantId, effectiveUserId, orderId, allSerialNumbers);
            this.logger.log(`✅ Successfully saved serial numbers to customer inventory`);
            
            // Verify the save immediately (by card codes, since CardInventory.orderId references CardOrder)
            const verifyCount = await this.prisma.cardInventory.count({
              where: {
                tenantId,
                soldToUserId: effectiveUserId,
                cardCode: { in: allSerialNumbers.map(s => s.serialNumber) },
                status: { in: ['SOLD', 'INVALID'] },
              },
            });
            this.logger.log(`✅ Verification: Found ${verifyCount} cards in inventory for user ${effectiveUserId} (order ${orderId})`);
          } else {
            this.logger.log(`ℹ️ skipNotifications is TRUE - skipping immediate inventory save for order ${orderId}`);
          }
        } catch (error: any) {
          this.logger.error(`❌ Failed to save serial numbers to customer inventory: ${error.message}`, error.stack);
          // Don't throw - continue with other delivery options
        }
      } else {
        this.logger.error(`❌ CRITICAL: Inventory delivery option selected but user not found - serial numbers CANNOT be saved to inventory for order ${orderId}`);
        this.logger.error(`   Customer email: ${finalCustomerEmail || 'N/A'}`);
        this.logger.error(`   Original userId: ${userId || 'NONE'}`);
        this.logger.error(`   User must be logged in to save serial numbers to inventory`);
        this.logger.error(`   Please ensure the customer is logged in before placing the order with inventory option`);
      }
    } else {
      this.logger.log(`ℹ️ Inventory delivery option not selected - skipping inventory save for order ${orderId}`);
      this.logger.log(`ℹ️ Available delivery options: ${JSON.stringify(deliveryOptionsList)}`);
    }
    
    // Send email if requested
    if (deliveryOptionsList.includes('email') && !skipNotifications) {
      await this.sendToEmail(tenantId, orderId, allSerialNumbers, userId, finalCustomerEmail, finalOrderNumber);
    }
    
    // Send WhatsApp if requested
    if (deliveryOptionsList.includes('whatsapp') && !skipNotifications) {
      await this.sendToWhatsApp(tenantId, orderId, allSerialNumbers, userId, finalCustomerPhone, finalOrderNumber);
    }

    this.logger.log(`Retrieved ${allSerialNumbers.length} serial numbers for order ${orderId}`);

    // Return serial numbers grouped by product for display
    const serialNumbersByProduct: Record<string, Array<{ serialNumber: string; pin?: string }>> = {};
    for (const serial of allSerialNumbers) {
      if (!serialNumbersByProduct[serial.productName]) {
        serialNumbersByProduct[serial.productName] = [];
      }
      serialNumbersByProduct[serial.productName].push({
        serialNumber: serial.serialNumber,
        pin: serial.pin,
      });
    }

    // Generate files if requested
    let excelFileUrl: string | undefined;
    let textFileUrl: string | undefined;
    let pdfFileUrl: string | undefined;

    if (deliveryOptionsList.includes('excel')) {
      try {
        excelFileUrl = await this.generateExcelFile(tenantId, orderId, allSerialNumbers);
      } catch (e: any) {
        this.logger.error(`Failed to generate Excel file: ${e?.message || String(e)}`);
      }
    }

    if (deliveryOptionsList.includes('text')) {
      try {
        textFileUrl = await this.generateTextFile(tenantId, orderId, allSerialNumbers);
      } catch (e: any) {
        this.logger.error(`Failed to generate text file: ${e?.message || String(e)}`);
      }
    }

    if (deliveryOptionsList.includes('pdf')) {
      try {
        pdfFileUrl = await this.generatePdfFile(tenantId, orderId, allSerialNumbers);
      } catch (e: any) {
        this.logger.error(`Failed to generate PDF file: ${e?.message || String(e)}`);
      }
    }

    const result: DigitalCardDeliveryResult = {
      serialNumbers: allSerialNumbers.map(c => c.serialNumber),
      serialNumbersByProduct: serialNumbersByProduct, // Grouped by product name
      deliveryOptions: deliveryOptionsList, // Return chosen delivery options
      excelFileUrl: skipNotifications ? undefined : excelFileUrl,
      textFileUrl: skipNotifications ? undefined : textFileUrl,
      pdfFileUrl: skipNotifications ? undefined : pdfFileUrl,
      _isPendingReveal: skipNotifications, // Flag for frontend
    };
    
    // If no serial numbers were found but we had processing errors, include them
    if (allSerialNumbers.length === 0 && processingErrors.length > 0) {
      result.error = processingErrors[0]; // Use first error as primary
      result.errorAr = "فشل في جلب بعض الأرقام التسلسلية. يرجى التواصل مع الدعم.";
      this.logger.warn(`⚠️ processDigitalCardsDelivery finished with 0 serial numbers and ${processingErrors.length} errors. First error: ${result.error}`);
    } else if (allSerialNumbers.length === 0) {
      result.error = "No serial numbers were returned from supplier.";
      result.errorAr = "لم يتم إرجاع أي أرقام تسلسلية من المورد.";
    }
    
    this.logger.log(`✅ ========== processDigitalCardsDelivery SUCCESS ==========`);
    this.logger.log(`📊 Total serial numbers: ${result.serialNumbers.length}`);
    this.logger.log(`📦 Products with serials: ${Object.keys(result.serialNumbersByProduct).length}`);
    this.logger.log(`📋 Product names: ${Object.keys(result.serialNumbersByProduct).join(', ') || 'NONE'}`);
    Object.keys(result.serialNumbersByProduct).forEach(productName => {
      this.logger.log(`  - ${productName}: ${result.serialNumbersByProduct[productName].length} serials`);
    });
    this.logger.log(`🚀 ========== processDigitalCardsDelivery END ==========`);
    
    return result;
  }

  /**
   * Generate text file with serial numbers in columns (SERIAL and PIN)
   */
  private async generateTextFile(
    tenantId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
  ): Promise<string> {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'digital-cards', tenantId);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const textFileName = `order-${orderId}-${timestamp}.txt`;
    const textPath = path.join(uploadsDir, textFileName);

    // Generate text file with SERIAL and PIN in columns (tab-separated)
    const lines = serialNumbers.map(card => {
      const serial = card.serialNumber || '';
      const pin = card.pin || '';
      return `${serial}\t${pin}`;
    });
    
    fs.writeFileSync(textPath, lines.join('\n'), 'utf-8');

    return `/uploads/digital-cards/${tenantId}/${textFileName}`;
  }

  /**
   * Generate Excel file with serial numbers
   */
  private async generateExcelFile(
    tenantId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
  ): Promise<string> {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'digital-cards', tenantId);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const excelFileName = `order-${orderId}-${timestamp}.xlsx`;
    const excelPath = path.join(uploadsDir, excelFileName);

    // Generate Excel file
    const workbook = xlsx.utils.book_new();
    const worksheetData = [
      ['Product Name', 'Serial Number', 'PIN'],
      ...serialNumbers.map(card => [
        card.productName,
        card.serialNumber,
        card.pin || '',
      ]),
    ];
    const worksheet = xlsx.utils.aoa_to_sheet(worksheetData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Serial Numbers');
    xlsx.writeFile(workbook, excelPath);

    return `/uploads/digital-cards/${tenantId}/${excelFileName}`;
  }

  /**
   * Generate PDF file with serial numbers
   */
  private async generatePdfFile(
    tenantId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
  ): Promise<string> {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'digital-cards', tenantId);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const timestamp = Date.now();
      const pdfFileName = `order-${orderId}-${timestamp}.pdf`;
      const pdfPath = path.join(uploadsDir, pdfFileName);

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // A4 size
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      let y = 800;
      const lineHeight = 20;
      const margin = 50;

      // Title
      page.drawText('Serial Numbers Inventory', {
        x: margin,
        y,
        size: 16,
        font: boldFont,
      });
      y -= 30;

      // Headers
      page.drawText('Product', { x: margin, y, size: 10, font: boldFont });
      page.drawText('Serial Number', { x: margin + 150, y, size: 10, font: boldFont });
      page.drawText('PIN', { x: margin + 300, y, size: 10, font: boldFont });
      y -= 20;

      // Data
      for (const card of serialNumbers) {
        if (y < 50) {
          const newPage = pdfDoc.addPage([595, 842]);
          y = 800;
        }

        page.drawText(card.productName || '', {
          x: margin,
          y,
          size: 9,
          font,
        });
        page.drawText(card.serialNumber, {
          x: margin + 150,
          y,
          size: 9,
          font,
        });
        page.drawText(card.pin || '-', {
          x: margin + 300,
          y,
          size: 9,
          font,
        });
        y -= lineHeight;
      }

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(pdfPath, pdfBytes);

      return `/uploads/digital-cards/${tenantId}/${pdfFileName}`;
    } catch (error: any) {
      this.logger.error(`❌ Failed to generate PDF: ${error.message}`);
      return '';
    }
  }

  /**
   * Save serial numbers to customer inventory
   * Ensures all serial numbers are properly linked to the customer's inventory
   */
  private async saveToCustomerInventory(
    tenantId: string,
    userId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
  ): Promise<void> {
    if (!userId) {
      this.logger.warn(`Cannot save to customer inventory: userId is required`);
      return;
    }

    if (serialNumbers.length === 0) {
      this.logger.warn(`No serial numbers to save to customer inventory for order ${orderId}`);
      return;
    }

    this.logger.log(`💾 Saving ${serialNumbers.length} serial numbers to customer inventory for user ${userId}, order ${orderId}, tenant ${tenantId}`);
    this.logger.log(`💾 Save details: userId=${userId}, tenantId=${tenantId}, orderId=${orderId}, serialCount=${serialNumbers.length}`);

    let savedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const serial of serialNumbers) {
      try {
        // Check if card already exists in inventory (by cardCode OR by orderId)
        // This handles cases where cards were created earlier with soldToUserId: null
        const existingCard = await this.prisma.cardInventory.findFirst({
          where: {
            tenantId,
            OR: [
              { cardCode: serial.serialNumber },
            ],
          },
        });

        if (existingCard) {
          // Update existing card to link it to the user if not already linked
          // This handles cases where cards were created with soldToUserId: null
          if (existingCard.soldToUserId !== userId) {
            await this.prisma.cardInventory.update({
              where: { id: existingCard.id },
              data: {
                soldToUserId: userId,
                status: 'SOLD',
                soldAt: existingCard.soldAt || new Date(),
                cardPin: serial.pin || existingCard.cardPin,
                // orderId: orderId, // Removed: CardInventory.orderId must point to CardOrder, not Order
              },
            });
            updatedCount++;
            this.logger.log(`✅ Updated card ${serial.serialNumber} in customer inventory for user ${userId} (was: ${existingCard.soldToUserId || 'NULL'})`);
          } else {
            this.logger.log(`✅ Card ${serial.serialNumber} already in customer inventory for user ${userId}`);
          }
        } else {
          // Find the product ID from the serial number's product name
          // We need to get the productId from the order items
          const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
              orderItems: {
                include: {
                  product: true,
                },
              },
            },
          });

          if (!order) {
            this.logger.error(`Order ${orderId} not found when saving to customer inventory`);
            errorCount++;
            continue;
          }

          // Find the matching order item by product name (try exact match first, then case-insensitive)
          let matchingItem = order.orderItems.find(
            item => item.productName === serial.productName
          );
          
          // If not found, try case-insensitive match
          if (!matchingItem) {
            matchingItem = order.orderItems.find(
              item => item.productName?.toLowerCase().trim() === serial.productName?.toLowerCase().trim()
            );
          }
          
          // If still not found, try partial match
          if (!matchingItem && serial.productName) {
            const serialNameLower = serial.productName.toLowerCase().trim();
            matchingItem = order.orderItems.find(
              item => item.productName?.toLowerCase().trim().includes(serialNameLower) ||
                      serialNameLower.includes(item.productName?.toLowerCase().trim() || '')
            );
          }
          
          // If still not found, use the first order item (fallback)
          if (!matchingItem && order.orderItems.length > 0) {
            this.logger.warn(`Could not find exact product match for serial ${serial.serialNumber} with product name "${serial.productName}". Available items: ${order.orderItems.map(i => i.productName).join(', ')}. Using first order item as fallback.`);
            matchingItem = order.orderItems[0];
          }

          if (!matchingItem) {
            this.logger.error(`Could not find any product for serial ${serial.serialNumber} with product name ${serial.productName}. Order has ${order.orderItems.length} items.`);
            errorCount++;
            continue;
          }

          // Create new card inventory entry
          try {
            const createdCard = await this.prisma.cardInventory.create({
              data: {
                tenantId,
                productId: matchingItem.productId,
                cardCode: serial.serialNumber,
                cardPin: serial.pin || null,
                status: 'SOLD',
                soldAt: new Date(),
                soldToUserId: userId,
                // orderId: orderId, // Removed: CardInventory.orderId must point to CardOrder, not Order
              },
            });
            savedCount++;
            this.logger.log(`✅ Saved card ${serial.serialNumber} to customer inventory:`, {
              cardId: createdCard.id,
              userId: createdCard.soldToUserId,
              tenantId: createdCard.tenantId,
              status: createdCard.status,
              orderId: createdCard.orderId,
            });
          } catch (createError: any) {
            // If card already exists (unique constraint), try to update it
            if (createError.code === 'P2002') {
              const existing = await this.prisma.cardInventory.findUnique({
                where: {
                  tenantId_cardCode: {
                    tenantId,
                    cardCode: serial.serialNumber,
                  },
                },
              });

              if (existing) {
                await this.prisma.cardInventory.update({
                  where: { id: existing.id },
                  data: {
                    soldToUserId: userId,
                    status: 'SOLD',
                    soldAt: existing.soldAt || new Date(),
                    cardPin: serial.pin || existing.cardPin,
                    // orderId: orderId, // Removed: CardInventory.orderId must point to CardOrder, not Order
                  },
                });
                updatedCount++;
                this.logger.log(`Updated existing card ${serial.serialNumber} in customer inventory for user ${userId}`);
              }
            } else {
              throw createError;
            }
          }
        }
      } catch (error: any) {
        errorCount++;
        this.logger.error(`Failed to save serial number ${serial.serialNumber} to customer inventory:`, error.message);
        // Continue processing other serial numbers
      }
    }

    this.logger.log(
      `✅ Customer inventory update completed for order ${orderId}: ${savedCount} saved, ${updatedCount} updated, ${errorCount} errors`
    );
    
    // Verify the save by counting cards for this user
    if (savedCount > 0 || updatedCount > 0) {
      const verifyCount = await this.prisma.cardInventory.count({
        where: {
          tenantId,
          soldToUserId: userId,
          cardCode: { in: serialNumbers.map(s => s.serialNumber) },
          status: 'SOLD',
        },
      });
      this.logger.log(`✅ Verification: Found ${verifyCount} cards in inventory for user ${userId} (order ${orderId})`);
      
      if (verifyCount === 0 && (savedCount > 0 || updatedCount > 0)) {
        this.logger.error(`❌ WARNING: Cards were saved but verification found 0 cards! This indicates a save failure.`);
      }
    }
  }

  /**
   * Send serial numbers to customer email
   */
  public async sendToEmail(
    tenantId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
    userId: string | null,
    customerEmail?: string,
    orderNumber?: string,
  ): Promise<void> {
    if (!customerEmail) {
      this.logger.warn(`No customer email provided for order ${orderId}, skipping email delivery`);
      return;
    }
      // Call email service - include /auth prefix as it's the global prefix in app-auth
      const authServiceUrl = (this.configService.get<string>('AUTH_API_URL') || process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
      const emailEndpoint = `${authServiceUrl}/auth/email/send`;

    try {
      // Fetch tenant information for store branding
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          nameAr: true,
          subdomain: true,
          settings: true,
          siteConfig: {
            select: {
              header: true,
            },
          },
        },
      });

      // Determine if this is a platform (Koun/Saeaa) transaction or a store transaction
      // Platform transactions: default/system tenant, kawn subdomain, or tenant not found
      const isPlatformTransaction = !tenant || 
                                   tenantId === 'default' || 
                                   tenantId === 'system' || 
                                   tenant?.subdomain === 'default' ||
                                   tenant?.subdomain === 'koun' ||
                                   tenant?.subdomain === 'saeaa' ||
                                   tenant?.subdomain === 'app' ||
                                   tenant?.subdomain === 'www';
      
      let storeName: string;
      let storeNameEn: string;
      let storeLogo: string | undefined;
      let fromEmail: string;
      let senderName: string;
      
      if (isPlatformTransaction) {
        // Use Koun platform branding
        const platformName = process.env.PLATFORM_NAME || 'Koun';
        const platformNameAr = process.env.PLATFORM_NAME_AR || 'كون';
        storeName = platformNameAr;
        storeNameEn = platformName;
        senderName = platformName;
        storeLogo = process.env.PLATFORM_LOGO_URL; // Platform logo from env
        fromEmail = `no-reply@${process.env.PLATFORM_DOMAIN || 'saeaa.com'}`;
        this.logger.log(`🏢 Using platform branding: ${platformName}`);
      } else {
        // Use store branding
        storeName = tenant?.nameAr || tenant?.name || 'Our Store';
        storeNameEn = tenant?.name || 'Our Store';
        
        // Fix sender name - use store name, but if it's "koun" or "kon", use subdomain or a fallback
        const normalizedStoreName = (tenant?.name || '').toLowerCase().trim();
        if (normalizedStoreName === 'koun' || normalizedStoreName === 'kawn' || normalizedStoreName === 'kon' || normalizedStoreName === 'kawn platform' || normalizedStoreName === 'saeaa' || normalizedStoreName === 'سيعة') {
          // If store name is "koun", use subdomain as identifier or a generic store name
          senderName = tenant?.subdomain && tenant.subdomain !== 'koun' && tenant.subdomain !== 'kawn' && tenant.subdomain !== 'saeaa' && tenant.subdomain !== 'default' && tenant.subdomain !== 'app' && tenant.subdomain !== 'www'
            ? tenant.subdomain.charAt(0).toUpperCase() + tenant.subdomain.slice(1)
            : (tenant?.nameAr || 'Our Store');
        } else {
          senderName = storeNameEn;
        }
        
        // Try to get logo from settings first, then from siteConfig header
        const settings = tenant?.settings as any;
        if (settings?.storeLogoUrl) {
          storeLogo = settings.storeLogoUrl;
          this.logger.log(`✅ Found logo from tenant settings: ${storeLogo}`);
        } else if (tenant?.siteConfig?.header && typeof tenant.siteConfig.header === 'object') {
          const header = tenant.siteConfig.header as any;
          // Try multiple possible logo field names
          storeLogo = header.logo || 
                     header.logoUrl || 
                     header.logoURL ||
                     header.image || 
                     header.imageUrl ||
                     header.imageURL ||
                     (header.elements && Array.isArray(header.elements) 
                       ? header.elements.find((el: any) => el.type === 'logo' || el.type === 'image')?.src || 
                         header.elements.find((el: any) => el.type === 'logo' || el.type === 'image')?.url
                       : undefined) ||
                     (header.logo && typeof header.logo === 'object' ? header.logo.src || header.logo.url : undefined);
        }
        
        // If logo is a relative path, convert to absolute URL
        if (storeLogo && !storeLogo.startsWith('http://') && !storeLogo.startsWith('https://') && !storeLogo.startsWith('data:')) {
          const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || `http://${tenant?.subdomain || 'localhost'}.localhost:8080`;
          storeLogo = storeLogo.startsWith('/') ? `${baseUrl}${storeLogo}` : `${baseUrl}/${storeLogo}`;
        }
        
        const emailDomain = `${tenant?.subdomain || 'store'}.${process.env.PLATFORM_DOMAIN || 'saeaa.com'}`;
        fromEmail = `no-reply@${emailDomain}`;
        this.logger.log(`🏪 Using store branding - Name: ${storeNameEn}, Sender: ${senderName}, Logo: ${storeLogo || 'NOT FOUND'}`);
        if (!storeLogo) {
          this.logger.warn(`⚠️ Logo not found. Checked settings.storeLogoUrl and siteConfig.header`);
        }
      }

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { customerEmail: true, orderNumber: true },
      });

      const email = customerEmail || order?.customerEmail;
      const finalOrderNumber = orderNumber || order?.orderNumber || orderId;

      if (!email) {
        this.logger.warn(`No email found for order ${orderId}`);
        return;
      }

      // Compute Variables for Links
      const crypto = require('crypto');
      const jwtSecret = process.env.JWT_SECRET || 'fallback-secret';
      const downloadToken = crypto.createHmac('sha256', jwtSecret)
          .update(`${orderId}:text`)
          .digest('hex');
          
      const appDomain = process.env.PLATFORM_DOMAIN || 'saeaa.com';
      // Basic URL construction
      const protocol = appDomain.includes('localhost') ? 'http' : 'https';
      const subdomain = tenant?.subdomain || 'www';
      const storeUrl = isPlatformTransaction 
          ? (process.env.FRONTEND_URL || `${protocol}://${appDomain}`)
          : `${protocol}://${subdomain}.${appDomain}`;
          
      const orderUrl = `${storeUrl}/orders/${orderId}`;
      const apiUrl = process.env.API_URL || 'http://localhost:3002/api';
      const downloadLink = `${apiUrl}/orders/${orderId}/public/download/text?token=${downloadToken}`;

      // Build email content with modern design matching verification email style
      const htmlContent = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #f8fafc;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header with Logo and Store Name -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1E293B 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
                      ${storeLogo ? `<img src="${storeLogo}" alt="${storeNameEn} Logo" style="max-width: 180px; height: auto; margin-bottom: 15px; display: block; margin-left: auto; margin-right: auto; border-radius: 8px;" />` : ''}
                      <h1 style="color: #ffffff; margin: 10px 0 0 0; font-size: ${storeLogo ? '24px' : '28px'}; font-weight: 700;">${storeName}</h1>
                      ${storeName !== storeNameEn ? `<p style="color: #06B6D4; margin: 5px 0 0 0; font-size: 14px; font-weight: 500;">${storeNameEn}</p>` : ''}
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px 30px;">
                      <h2 style="color: #1E293B; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-align: right;">
                        مرحباً بك في ${storeName}!
                      </h2>
                      <p style="color: #475569; margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; text-align: right;">
                        شكراً لشرائك من ${storeName}. يرجى العثور على رموز PIN الخاصة بك أدناه.
                      </p>
                      
                      <!-- Order Number Box -->
                      <div style="background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); padding: 20px; border-radius: 8px; margin-bottom: 30px; text-align: right;">
                        <p style="margin: 0; color: #64748b; font-size: 14px; font-weight: 500;">رقم الطلب / Order Number</p>
                        <p style="margin: 5px 0 0 0; color: #1E293B; font-size: 20px; font-weight: 700;">${finalOrderNumber}</p>
                      </div>
                      
                      <!-- PIN Codes Section -->
                      <h3 style="color: #1E293B; margin: 30px 0 20px 0; font-size: 20px; font-weight: 600; text-align: right;">
                        رموز PIN / PIN Codes
                      </h3>
                      
                      ${serialNumbers.filter(card => card.pin || card.serialNumber).map((card, index) => {
                        const pinCode = card.pin || '';
                        const serialNum = card.serialNumber || '';
                        const pinId = `pin-${index}`;
                        const serialId = `serial-${index}`;
                        return `
                        <div style="background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <span style="color: #64748b; font-size: 14px; font-weight: 500;">#${index + 1}</span>
                            <h4 style="margin: 0; color: #1E293B; font-size: 16px; font-weight: 600; text-align: right;">${card.productName}</h4>
                          </div>
                          
                          <div style="background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); border-radius: 8px; padding: 25px; text-align: center; position: relative; margin-bottom: 10px;">
                            ${serialNum ? `
                              <p style="margin: 0 0 8px 0; color: #ffffff; font-size: 12px; font-weight: 600; opacity: 0.9; text-transform: uppercase;">رقم الكرت / Card Serial</p>
                              <div style="margin: 0 0 15px 0; padding: 10px; background-color: rgba(255, 255, 255, 0.1); border-radius: 6px; border: 1px dashed rgba(255, 255, 255, 0.2);">
                                <p id="${serialId}" style="margin: 0; color: #ffffff; font-size: 16px; font-weight: 600; font-family: 'Courier New', monospace; word-break: break-all; letter-spacing: 1px;">${serialNum}</p>
                              </div>
                            ` : ''}
                            
                            ${pinCode ? `
                              <p style="margin: 0 0 8px 0; color: #ffffff; font-size: 14px; font-weight: 700; opacity: 0.9;">رمز PIN / PIN Code</p>
                              <div style="margin: 0 0 12px 0; padding: 15px; background-color: rgba(0, 0, 0, 0.2); border-radius: 6px; border: 2px dashed rgba(255, 255, 255, 0.3);">
                                <p id="${pinId}" style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; font-family: 'Courier New', monospace; word-break: break-all; letter-spacing: 2px;">${pinCode}</p>
                              </div>
                            ` : ''}
                            
                            <table cellpadding="0" cellspacing="0" border="0" style="margin: 15px auto 0; width: 100%; max-width: 450px;">
                              <tr>
                                <td align="center" style="padding: 8px;">
                                  <table cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 6px;">
                                    <tr>
                                      <td align="center" style="padding: 10px 20px;">
                                        <a href="${orderUrl}" target="_blank" style="color: #ffffff; font-size: 14px; font-weight: 500; text-decoration: none; display: block;">عرض الطلب / View Order</a>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </div>
                        </div>
                        `;
                      }).join('')}
                      
                      <p style="color: #64748b; font-size: 14px; margin-top: 30px; text-align: center; line-height: 1.6;">
                        شكراً لشرائك من ${storeName}<br>
                        <span style="color: #94a3b8;">Thank you for your purchase from ${storeNameEn}!</span>
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                        © ${new Date().getFullYear()} ${storeNameEn}. جميع الحقوق محفوظة.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const textContent = `
${storeNameEn}

Order Number: ${finalOrderNumber}

PIN Codes:
${serialNumbers.filter(card => card.pin || card.serialNumber).map((card, index) => `${index + 1}. ${card.productName} ${card.serialNumber ? `- Serial: ${card.serialNumber}` : ''} ${card.pin ? `- PIN: ${card.pin}` : ''}`).join('\n')}

Thank you for your purchase from ${storeNameEn}!
      `;

      // Build final from name
      const fromName = senderName;

      this.logger.log(`📧 Email Params - To: ${email}, FromName: ${fromName}, Tenant: ${tenantId}, Order: ${orderId}`);
      this.logger.log(`🔗 Email Service Config - authServiceUrl: ${authServiceUrl}, Endpoint: ${emailEndpoint}`);
        const payload = {
          to: email,
          fromName: fromName,
          tenantId: tenantId,
          subject: `رموز PIN - ${senderName} - Order ${finalOrderNumber} - PIN Codes`,
          html: htmlContent,
          text: textContent,
        };
        this.logger.log(`📦 Email Payload: ${JSON.stringify({ ...payload, html: '[HTML CONTENT]', text: '[TEXT CONTENT]' })}`);
        
        await firstValueFrom(
          this.httpService.post(emailEndpoint, payload),
        );

        this.logger.log(`Email sent successfully to ${email} for order ${orderId}`);
      } catch (error: any) {
        const errorMsg = error.response?.data?.message || error.message || 'Unknown email error';
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : (error.stack || '');
        this.logger.error(`Failed to send email for order ${orderId} via ${authServiceUrl}: ${errorMsg} - Details: ${errorDetails}`);
        // Throw HttpException so it propagates to client even in production
        throw new InternalServerErrorException(`Email sending failed: ${errorMsg}`);
      }
  }

  /**
   * Send serial numbers to customer WhatsApp
   */
  public async sendToWhatsApp(
    tenantId: string,
    orderId: string,
    serialNumbers: Array<{ productName: string; serialNumber: string; pin?: string }>,
    userId: string | null,
    customerPhone?: string,
    orderNumber?: string,
  ): Promise<void> {
    if (!customerPhone) {
      this.logger.warn(`No customer phone provided for order ${orderId}, skipping WhatsApp delivery`);
      return;
    }

    try {
      // Fetch tenant information for store branding
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          nameAr: true,
          subdomain: true,
        },
      });

      // Determine if this is a platform (Koun/Saeaa) transaction or a store transaction
      const isPlatformTransaction = !tenantId || 
                                   tenantId === 'default' || 
                                   tenantId === 'system' ||
                                   tenant?.subdomain === 'koun' ||
                                   tenant?.subdomain === 'saeaa' ||
                                   !tenant;
      
      let storeName: string;
      let storeNameEn: string;
      
      if (isPlatformTransaction) {
        // Use Koun platform branding
        const platformName = process.env.PLATFORM_NAME || 'Saeaa';
        const platformNameAr = process.env.PLATFORM_NAME_AR || 'سيعة';
        storeName = platformNameAr;
        storeNameEn = platformName;
      } else {
        // Use store branding
        storeName = tenant?.nameAr || tenant?.name || 'Our Store';
        storeNameEn = tenant?.name || 'Our Store';
      }

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { customerPhone: true, orderNumber: true },
      });

      const phone = customerPhone || order?.customerPhone;
      const finalOrderNumber = orderNumber || order?.orderNumber || orderId;

      if (!phone) {
        this.logger.warn(`No phone number found for order ${orderId}`);
        return;
      }

      // Format phone number (remove any non-digit characters except +)
      const formattedPhone = phone.replace(/[^\d+]/g, '');

      // Generate WhatsApp message
      const message = `*${storeNameEn} - Order ${finalOrderNumber} - Serial Numbers*\n\n` +
        serialNumbers.map((card, index) => 
          `${index + 1}. *${card.productName}*\nSerial: ${card.serialNumber}${card.pin ? `\nPIN: ${card.pin}` : ''}`
        ).join('\n\n') +
        `\n\nThank you for your purchase from ${storeNameEn}!`;

      // TODO: Integrate with WhatsApp API (Twilio, WhatsApp Business API, etc.)
      // For now, log the message that would be sent
      this.logger.log(`WhatsApp message for order ${orderId} (would send to ${formattedPhone}):\n${message}`);
      
      // Example integration with WhatsApp Business API would go here:
      // await this.whatsappService.sendMessage(formattedPhone, message);
      
      this.logger.warn(`WhatsApp sending requires WhatsApp API integration. Message prepared for ${formattedPhone}`);
    } catch (error: any) {
      this.logger.error(`Failed to send WhatsApp for order ${orderId}:`, error.message);
      // Don't throw - WhatsApp failure shouldn't break the order
    }
  }

  /**
   * Get delivery files for an order
   */
  async getDeliveryFiles(orderId: string): Promise<{ excelFileUrl?: string; textFileUrl?: string } | null> {
    // Check if order has associated cards
    const cards = await this.prisma.cardInventory.findMany({
      where: { orderId, status: 'SOLD' },
      take: 1,
    });

    if (cards.length === 0) {
      return null;
    }

    // Find files in uploads directory
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { tenantId: true },
    });

    if (!order) {
      return null;
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'digital-cards', order.tenantId);
    const files = fs.readdirSync(uploadsDir).filter(f => f.startsWith(`order-${orderId}-`));

    const excelFile = files.find(f => f.endsWith('.xlsx'));
    const textFile = files.find(f => f.endsWith('.txt'));

    return {
      excelFileUrl: excelFile ? `/uploads/digital-cards/${order.tenantId}/${excelFile}` : undefined,
      textFileUrl: textFile ? `/uploads/digital-cards/${order.tenantId}/${textFile}` : undefined,
    };
  }

  /**
   * Helper to lookup product code from SupplierProduct table using fuzzy name matching
   */
  private async lookupSupplierProductCode(productName: string): Promise<string | null> {
    try {
      if (!productName) return null;
      
      this.logger.debug(`🔍 Attempting fuzzy lookup for product name: "${productName}"`);
      
      const supplierProducts = await this.prisma.supplierProduct.findMany({
        where: { isActive: true, isAvailable: true },
        select: { productCode: true, nameEn: true, nameAr: true },
      });
      
      // Simple name matching
      const normalizeName = (name: string) => 
        name.toLowerCase()
          .replace(/\$|€|£|¥|SAR|AED|USD|EUR|GBP|JPY|OMR|BHD|KWD|QAR/gi, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/\s+/g, ' ')
          .trim();
          
      const strictNormalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      const normalizedProductName = normalizeName(productName);
      const strictProductName = strictNormalize(productName);
      
      if (!normalizedProductName || normalizedProductName.length < 3) {
          return null;
      }
      
      let bestMatch: { productCode: string; score: number } | null = null;
      
      for (const sp of supplierProducts) {
        const rawNameEn = sp.nameEn || '';
        const rawNameAr = sp.nameAr || '';
        
        const normalizedSpName = normalizeName(rawNameEn);
        const normalizedSpNameAr = normalizeName(rawNameAr);
        
        const strictSpName = strictNormalize(rawNameEn);
        const strictSpNameAr = strictNormalize(rawNameAr);
        
        // 1. Exact match (Standard Normalization)
        if (normalizedProductName === normalizedSpName || normalizedProductName === normalizedSpNameAr) {
           this.logger.log(`✅ Exact match found in SupplierProduct: ${sp.productCode}`);
           return sp.productCode;
        }
        
        // 2. Exact Match (Strict Normalization - ignores spaces/symbols)
        if ((strictProductName && strictSpName && strictProductName === strictSpName) || 
            (strictProductName && strictSpNameAr && strictProductName === strictSpNameAr)) {
           this.logger.log(`✅ Strict match found (ignoring spaces): ${sp.productCode} for "${productName}"`);
           return sp.productCode;     
        }
        
        // 3. Partial match scoring
        let currentScore = 0;
        const normalizedSpNameLen = normalizedSpName.length;
        const normalizedSpNameArLen = normalizedSpNameAr.length;
        const normalizedProductNameLen = normalizedProductName.length;

        // Try English name match
        if (normalizedSpName && (normalizedProductName.includes(normalizedSpName) || normalizedSpName.includes(normalizedProductName))) {
            const ratio = Math.min(normalizedProductNameLen, normalizedSpNameLen) / Math.max(normalizedProductNameLen, normalizedSpNameLen);
            if (ratio > 0.6) currentScore = Math.max(currentScore, ratio);
        }
        
        // Try Arabic name match
        if (normalizedSpNameAr && (normalizedProductName.includes(normalizedSpNameAr) || normalizedSpNameAr.includes(normalizedProductName))) {
             const ratio = Math.min(normalizedProductNameLen, normalizedSpNameArLen) / Math.max(normalizedProductNameLen, normalizedSpNameArLen);
             if (ratio > 0.6) currentScore = Math.max(currentScore, ratio);
        }
        
        // Try strict substring match (high confidence fallback)
        if (currentScore < 0.6 && strictProductName.length > 5) { // Only if reasonable length
             if (strictSpName && (strictProductName.includes(strictSpName) || strictSpName.includes(strictProductName))) {
                 // Check if it's a very strong substring match
                 const sRatio = Math.min(strictProductName.length, strictSpName.length) / Math.max(strictProductName.length, strictSpName.length);
                 if (sRatio > 0.8) currentScore = Math.max(currentScore, sRatio * 0.9); // Slight penalty for using strict
             }
        }

        if (currentScore > 0) {
            if (!bestMatch || currentScore > bestMatch.score) {
                bestMatch = { productCode: sp.productCode, score: currentScore };
            }
        }
      }
      
      if (bestMatch && bestMatch.score >= 0.6) { // Lowered threshold slightly to 0.6
        this.logger.log(`✅ Fuzzy match found: ${bestMatch.productCode} (score: ${bestMatch.score.toFixed(2)})`);
        return bestMatch.productCode;
      }
    } catch (error: any) {
      this.logger.error(`❌ lookupSupplierProductCode failed: ${error.message}`);
    }
    return null;
  }
}


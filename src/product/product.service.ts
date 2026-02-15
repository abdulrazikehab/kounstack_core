import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSyncService } from '../tenant/tenant-sync.service'; // Add this import
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private prisma: PrismaService,
    private tenantSyncService: TenantSyncService, // Add this dependency
  ) {}

  /**
   * Generate a SKU based on product name and tenant.
   *
   * Rules:
   * - Prefix = first two letters of first two words of the English name (lowercase),
   *   fallback to 'pr' if not available.
   * - If word has only one letter, take that letter. If word has 2+ letters, take first 2 letters.
   * - Suffix = 3‑digit sequence per tenant+prefix (001, 002, 003, ...).
   * - Ensures uniqueness per tenant by always picking the next available number.
   * 
   * Example: "Product Name" -> "pron001", "pron002", etc.
   * Example: "Product" -> "pr001" (single word, first 2 chars)
   * Example: "A B" -> "ab001" (two single-letter words)
   */
  private async generateSku(tenantId: string, name: string): Promise<string> {
    const rawName = (name || '').trim().toLowerCase();
    
    // Extract first two words
    const words = rawName.split(/\s+/).filter(w => w.length > 0);
    let prefix = 'pr'; // default fallback
    
    if (words.length >= 2) {
      // Use first letter of first two words (as per user requirement: "wx pu001" pattern)
      const firstWord = words[0].replace(/[^a-z0-9]/g, '');
      const secondWord = words[1].replace(/[^a-z0-9]/g, '');
      
      const firstChar = firstWord.charAt(0) || '';
      const secondChar = secondWord.charAt(0) || '';
      
      if (firstChar && secondChar) {
        prefix = firstChar + secondChar;
      } else if (firstChar) {
        prefix = firstChar + 'x';
      }
    } else if (words.length === 1) {
      // If only one word, use first two characters
      const word = words[0].replace(/[^a-z0-9]/g, '');
      if (word.length >= 2) {
        prefix = word.substring(0, 2);
      } else if (word.length === 1) {
        prefix = word + 'x';
      }
    }

    // Find the last SKU for this tenant + prefix, ordered descending
    const lastWithPrefix = await this.prisma.product.findFirst({
      where: {
        tenantId,
        sku: {
          startsWith: prefix,
        },
      },
      orderBy: {
        sku: 'desc',
      },
      select: {
        sku: true,
      },
    });

    let nextNumber = 1;
    if (lastWithPrefix?.sku && lastWithPrefix.sku.length > prefix.length) {
      const numericPart = lastWithPrefix.sku.substring(prefix.length);
      const parsed = parseInt(numericPart, 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        nextNumber = parsed + 1;
      }
    }

    const sku = `${prefix}${String(nextNumber).padStart(3, '0')}`;
    this.logger.log(`Generated SKU "${sku}" for product "${name}" (tenant: ${tenantId})`);
    return sku;
  }

  async create(tenantId: string, createProductDto: CreateProductDto, upsert?: boolean): Promise<ProductResponseDto> {
    if (!tenantId) {
      this.logger.error('❌ Product creation failed: tenantId is null or undefined');
      throw new ForbiddenException('Tenant ID is required. Please ensure you are authenticated and have a market set up.');
    }

    this.logger.log(`🔄 Creating product for tenant: ${tenantId}${upsert ? ' (upsert mode)' : ''}`);

    // FIRST: Check if tenant exists
    try {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      
      if (!existingTenant) {
        this.logger.error(`❌ Tenant ${tenantId} does not exist in database`);
        throw new ForbiddenException(
          `Cannot create product: Tenant ${tenantId} does not exist. Please set up your market first by going to Market Setup.`
        );
      }
    } catch (error: any) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`❌ Error checking tenant ${tenantId}:`, error);
      throw new ForbiddenException(`Cannot create product: Failed to verify tenant. Please try again or contact support.`);
    }

    // Pre-processing and Validation
    // Extract everything except SKU first (SKU handled in loop if auto)
    const { variants, images, categoryIds, suppliers, supplierIds, tags, ...createData } = createProductDto;
    const productData = { ...createData }; // Clone to avoid mutation issues

    // Validate categories exist if provided
    let validCategoryIds: string[] = [];
    if (categoryIds && categoryIds.length > 0) {
      const existingCategories = await this.prisma.category.findMany({
        where: {
          id: { in: categoryIds },
          tenantId: tenantId,
        },
        select: { id: true },
      });

      validCategoryIds = existingCategories.map((cat: { id: any; }) => cat.id);
      
      if (validCategoryIds.length !== categoryIds.length) {
        const invalidCategories = categoryIds.filter(id => !validCategoryIds.includes(id));
        this.logger.warn(`⚠️ Some categories do not exist or don't belong to tenant: ${invalidCategories.join(', ')}`);
      }
    }

    // Validate brand exists if provided
    if (productData.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: {
          id: productData.brandId,
          tenantId,
        },
      });
      if (!brand) {
        this.logger.warn(`⚠️ Brand ${productData.brandId} not found, creating product without brand`);
        delete productData.brandId;
      }
    }

    // Validate suppliers exist if provided
    let validSuppliers: Array<{ 
      supplierId: string; 
      discountRate?: number; 
      isPrimary?: boolean; 
      price?: number; 
      cost?: number; 
      supplierProductCode?: string 
    }> = [];
    let bestSupplierPrice: number | null = null;
    
    if (suppliers && suppliers.length > 0) {
      for (const supplierData of suppliers) {
        const supplier = await this.prisma.supplier.findFirst({
          where: {
            id: supplierData.supplierId,
            tenantId,
            isActive: true,
          },
        });
        if (supplier) {
          const supplierPrice = supplierData.cost !== undefined ? Number(supplierData.cost) : (supplierData.price ? Number(supplierData.price) : null);
          
          if (supplierPrice !== null && supplierPrice > 0) {
            if (bestSupplierPrice === null || supplierPrice < bestSupplierPrice) {
              bestSupplierPrice = supplierPrice;
            }
          }
          
          // Auto-calculate discountRate: ((ProductPrice - SupplierCost) / ProductPrice) * 100
          let calculatedDiscount = supplierData.discountRate;
          const productPrice = Number(productData.price || 0);
          if (productPrice > 0 && supplierPrice !== null) {
            calculatedDiscount = ((productPrice - supplierPrice) / productPrice) * 100;
          }

          validSuppliers.push({
            supplierId: supplierData.supplierId,
            discountRate: calculatedDiscount !== undefined ? calculatedDiscount : (supplier.discountRate || 0),
            isPrimary: supplierData.isPrimary || false,
            price: supplierPrice || undefined,
            cost: supplierPrice || undefined,
            supplierProductCode: supplierData.supplierProductCode,
          });
        }
      }
    } else if (supplierIds && supplierIds.length > 0) {
      const existingSuppliers = await this.prisma.supplier.findMany({
        where: {
          id: { in: supplierIds },
          tenantId,
          isActive: true,
        },
      });
      validSuppliers = existingSuppliers.map((s: any, index: number) => ({
        supplierId: s.id,
        discountRate: Number(s.discountRate),
        isPrimary: index === 0,
      }));
    }

    // Auto-calculate costPerItem
    if (validSuppliers.length > 0 && bestSupplierPrice !== null && bestSupplierPrice > 0) {
      if (!productData.costPerItem || productData.costPerItem === 0) {
        productData.costPerItem = bestSupplierPrice;
        this.logger.log(`💰 Auto-set costPerItem to best supplier price: ${bestSupplierPrice}`);
      }
    }

    // Process tags
    let tagItemsData: Array<{ tagId: string }> = [];
    if (tags && tags.length > 0) {
      const createSlug = (name: string): string => {
        return name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
      };

      for (const tagName of tags) {
        if (!tagName || !tagName.trim()) continue;
        
        const tagSlug = createSlug(tagName);
        
        let productTag = await this.prisma.productTag.findUnique({
          where: {
            tenantId_slug: {
              tenantId,
              slug: tagSlug,
            },
          },
        });

        if (!productTag) {
          productTag = await this.prisma.productTag.create({
            data: {
              tenantId,
              name: tagName.trim(),
              slug: tagSlug,
            },
          });
        }
        tagItemsData.push({ tagId: productTag.id });
      }
    }

    // START CREATION LOGIC WITH RETRY
    const isAutoSku = !productData.sku || !productData.sku.trim();
    let retryCount = isAutoSku ? 3 : 0;
    
    while (true) {
      // 1. Generate SKU if needed
      if (isAutoSku) {
        productData.sku = await this.generateSku(tenantId, productData.name);
      }

      // 2. Check for existence if SKU provided (handle upsert/conflict)
      if (!isAutoSku && productData.sku) {
        const existingProduct = await this.prisma.product.findFirst({
          where: {
            tenantId,
            sku: productData.sku,
          },
        }) as { id: string } | null;

        if (existingProduct) {
          if (upsert) {
            this.logger.log(`🔄 SKU exists, updating product: ${existingProduct.id}`);
            return this.update(tenantId, existingProduct.id, createProductDto);
          } else {
            throw new ConflictException('SKU must be unique within your store');
          }
        }
      }

      try {
        this.logger.log(`📦 Creating product in database (SKU: ${productData.sku})...`);
        
        const product = await this.prisma.product.create({
          data: {
            ...productData,
            tenantId,
            variants: variants ? {
              create: variants.map(variant => ({
                ...variant,
              })),
            } : undefined,
            images: images ? {
              create: images.map((image, index) => ({
                ...image,
                sortOrder: image.sortOrder || index,
              })),
            } : undefined,
            categories: validCategoryIds.length > 0 ? {
              create: validCategoryIds.map(categoryId => ({
                category: {
                  connect: { id: categoryId },
                },
              })),
            } : undefined,
            ...(validSuppliers.length > 0 && {
              suppliers: {
                create: validSuppliers.map(s => ({
                  supplierId: s.supplierId,
                  discountRate: s.discountRate,
                  isPrimary: s.isPrimary,
                  cost: s.cost ? new Decimal(s.cost) : undefined,
                  supplierProductCode: s.supplierProductCode,
                  lastPrice: s.cost ? new Decimal(s.cost) : undefined,
                  lastPriceCheck: s.cost ? new Date() : undefined,
                })),
              },
            }),
            ...(productData.unitId && { unitId: productData.unitId }),
            ...(tagItemsData.length > 0 && {
              tagItems: {
                create: tagItemsData,
              },
            }),
          },
          include: (() => {
            const includeObj: any = {
              variants: true,
              images: {
                orderBy: {
                  sortOrder: 'asc',
                },
              },
              categories: {
                include: {
                  category: true,
                },
              },
            };
            
            // Always include suppliers and brand
            includeObj.suppliers = {
              include: {
                supplier: true,
              },
            };
            includeObj.brand = true;
            
            includeObj.unit = true;
            includeObj.tagItems = {
              include: {
                tag: true,
              },
            };
            
            return includeObj;
          })(),
        });
    
        this.logger.log(`✅ Product created successfully: ${product.id}`);
        return this.mapToResponseDto(product);
      } catch (error: any) {
        // Handle Unique Constraint Violation (P2002)
        if (error?.code === 'P2002') {
          // Case 1: Auto-generated SKU collision -> Retry with new SKU
          if (isAutoSku && retryCount > 0) {
            this.logger.warn(`⚠️ Auto-generated SKU collision (${productData.sku}), retrying... (${retryCount} left)`);
            retryCount--;
            continue; // Loop again to regenerate SKU and retry
          }
          
          // Case 2: User-provided SKU collision in Upsert mode -> Update existing
          if (upsert && !isAutoSku && productData.sku) {
             this.logger.log(`🔄 Unique constraint violation in upsert mode (user SKU), retrying as update...`);
             const existing = await this.prisma.product.findFirst({
                where: { tenantId, sku: productData.sku },
                select: { id: true }
             });
             if (existing) {
               return this.update(tenantId, existing.id, createProductDto);
             }
          }
          
          // Case 3: Actual Conflict
          const targets = error.meta?.target || [];
          if (targets.includes('sku') || targets.includes('tenantId_sku')) {
            throw new ConflictException('SKU must be unique within your store. A product with this SKU already exists.');
          }
          throw new ConflictException(`A product with these values already exists: ${targets.join(', ')}`);
        }
        
        // Handle Foreign Key Error
        if (error?.code === 'P2003') {
          throw new ForbiddenException(`Cannot create product: Tenant ${tenantId} does not exist in the system`);
        }
        
        this.logger.error(`❌ Product creation failed for tenant ${tenantId}:`, error);
        throw error;
      }
    }
  }

  async findAll(tenantId: string, page: number = 1, limit: number = 10, filters?: any) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    // Check if tenant exists before querying
    const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId);
    if (!tenantExists) {
      // If tenant doesn't exist and can't be created, return empty result
      this.logger.warn(`⚠️ Tenant ${tenantId} does not exist. Returning empty products list.`);
      return {
        data: [],
        meta: {
          total: 0,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          totalPages: 0,
        },
      };
    }

    // Coerce query parameters to numbers to avoid NaN
    const pageNum = Number(page) || 1;
    let limitNum = Number(limit) || 10;
    
    // Safety: Enforce maximum limit to prevent CPU/memory issues
    const MAX_LIMIT = 1000;
    if (limitNum > MAX_LIMIT) {
      this.logger.warn(`⚠️ Limit ${limitNum} exceeds maximum ${MAX_LIMIT}, capping to ${MAX_LIMIT}`);
      limitNum = MAX_LIMIT;
    }
    
    // Safety: Ensure limit is positive
    if (limitNum < 1) {
      limitNum = 10;
    }
    
    const skip = (pageNum - 1) * limitNum;

    this.logger.log(`📦 Finding products for tenant ${tenantId} with filters:`, filters);

    // Build where clause
    const where: any = { tenantId };
    
    // Apply category filter through junction table - only include active categories
    if (filters?.categoryId) {
      where.categories = {
        some: {
          categoryId: filters.categoryId,
          category: {
            isActive: true, // Ensure category is active
          },
        },
      };
      this.logger.log(`🔍 Filtering by categoryId: ${filters.categoryId}`);
    }
    // Note: We don't filter out products with inactive categories when no category filter is specified
    // because products might not have categories or might have multiple categories (some active, some inactive)
    // The categories relation in the include will filter to only show active categories in the response
    
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    
    if (filters?.minPrice || filters?.maxPrice) {
      where.price = {};
      if (filters.minPrice) where.price.gte = filters.minPrice;
      if (filters.maxPrice) where.price.lte = filters.maxPrice;
    }
    
    if (filters?.isActive !== undefined) {
      where.isAvailable = filters.isActive;
    }

    // Build include object - conditionally include new relations
    const include: any = {
      variants: true,
      images: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      categories: {
        include: {
          category: true,
        },
      },
    };

    // Conditionally include suppliers and brand if schema supports them
    // Check if the relation fields exist in the Prisma schema
    // Always include suppliers and brand
    include.suppliers = {
      include: {
        supplier: true,
      },
    };
    include.brand = true;
    
    // Always try to include unit
    include.unit = true;

    let products: any[];
    let total: number;

    try {
      // Try with full includes (suppliers, brand)
      [products, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include,
          skip,
          take: limitNum,
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this.prisma.product.count({
          where,
        }),
      ]);
    } catch (error: any) {
      // If tenant doesn't exist in database, return empty result
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        this.logger.warn(`⚠️ Tenant ${tenantId} does not exist in database. Returning empty products list.`);
        return {
          data: [],
          meta: {
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
            hasMore: false,
          },
        };
      }
      // If relations don't exist yet, fall back to basic includes
      this.logger.warn('New relations not available, using basic query:', error.message);
      const basicInclude = {
        variants: true,
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        categories: {
          include: {
            category: true,
          },
        },
      };
      try {
        [products, total] = await Promise.all([
          this.prisma.product.findMany({
            where,
            include: basicInclude,
            skip,
            take: limitNum,
            orderBy: {
              createdAt: 'desc',
            },
          }),
          this.prisma.product.count({
            where,
          }),
        ]);
      } catch (fallbackError: any) {
        // If tenant still doesn't exist, return empty result
        if (fallbackError?.code === 'P2003' || fallbackError?.message?.includes('Foreign key constraint')) {
          this.logger.warn(`⚠️ Tenant ${tenantId} does not exist in database. Returning empty products list.`);
          return {
            data: [],
            meta: {
              total: 0,
              page: pageNum,
              limit: limitNum,
              totalPages: 0,
            },
          };
        }
        throw fallbackError;
      }
    }

    this.logger.log(`📦 Fetched ${products.length} products for tenant ${tenantId} (total: ${total})`);
    if (products.length > 0) {
      this.logger.log(`Sample product data: ${JSON.stringify({
        id: products[0].id,
        name: products[0].name,
        price: products[0].price,
        priceType: typeof products[0].price,
        images: products[0].images?.length || 0,
        variants: products[0].variants?.length || 0,
        categories: products[0].categories?.length || 0
      })}`);
    }

    return {
      data: products.map((product: any) => this.mapToResponseDto(product)),
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: pageNum < Math.ceil(total / limitNum),
      },
    };
  }

  async findOne(tenantId: string, id: string): Promise<ProductResponseDto> {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    // Check if tenant exists
    const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId);
    if (!tenantExists) {
      throw new NotFoundException(`Product not found: Tenant ${tenantId} does not exist`);
    }

    // Build include object - conditionally include new relations
    const includeObj: any = {
      variants: true,
      images: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      categories: {
        include: {
          category: true,
        },
      },
    };

    // Conditionally include suppliers and brand
    // Always include suppliers and brand
    includeObj.suppliers = {
      include: {
        supplier: true,
      },
    };
    includeObj.brand = true;
    
    // Always try to include unit
    includeObj.unit = true;

    let product: any;
    
    try {
      product = await this.prisma.product.findFirst({
        where: {
          id,
          tenantId,
        },
        include: includeObj,
      });
    } catch (error: any) {
      // Fall back to basic includes if relations don't exist
      this.logger.warn('New relations not available, using basic query:', error.message);
      product = await this.prisma.product.findFirst({
        where: {
          id,
          tenantId,
        },
        include: {
          variants: true,
          images: {
            orderBy: {
              sortOrder: 'asc',
            },
          },
          categories: {
            include: {
              category: true,
            },
          },
        },
      });
    }

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.mapToResponseDto(product);
  }

  async update(tenantId: string, id: string, updateProductDto: UpdateProductDto): Promise<ProductResponseDto> {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    // Ensure tenant exists
    await this.tenantSyncService.ensureTenantExists(tenantId);

    // Verify product exists and belongs to tenant
    const existingProduct = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });

    if (!existingProduct) {
      throw new NotFoundException('Product not found');
    }

    const { variants, images, categoryIds, tags, suppliers, supplierIds, brandId, unitId, ...productData } = updateProductDto;

    // Validate and process suppliers if provided
    let validSuppliers: Array<{ 
      supplierId: string; 
      discountRate?: number; 
      isPrimary?: boolean; 
      price?: number; 
      cost?: number; 
      supplierProductCode?: string 
    }> = [];
    let bestSupplierPrice: number | null = null;
    
    if (suppliers && suppliers.length > 0) {
      for (const supplierData of suppliers) {
        const supplier = await this.prisma.supplier.findFirst({
          where: {
            id: supplierData.supplierId,
            tenantId,
            isActive: true,
          },
        });
        if (supplier) {
          const supplierPrice = supplierData.cost !== undefined ? Number(supplierData.cost) : (supplierData.price ? Number(supplierData.price) : null);
          
          // Track the best (lowest) price
          if (supplierPrice !== null && supplierPrice > 0) {
            if (bestSupplierPrice === null || supplierPrice < bestSupplierPrice) {
              bestSupplierPrice = supplierPrice;
            }
          }
          
          // Auto-calculate discountRate: ((ProductPrice - SupplierCost) / ProductPrice) * 100
          let calculatedDiscount = supplierData.discountRate;
          const productPrice = Number(updateProductDto.price || existingProduct.price || 0);
          if (productPrice > 0 && supplierPrice !== null) {
            calculatedDiscount = ((productPrice - supplierPrice) / productPrice) * 100;
          }

          validSuppliers.push({
            supplierId: supplierData.supplierId,
            discountRate: calculatedDiscount !== undefined ? calculatedDiscount : (supplier.discountRate || 0),
            isPrimary: supplierData.isPrimary || false,
            price: supplierPrice || undefined,
            cost: supplierPrice || undefined,
            supplierProductCode: supplierData.supplierProductCode,
          });
        }
      }
    } else if (supplierIds && supplierIds.length > 0) {
      // If only supplierIds provided, use default discount rates (no prices)
      const existingSuppliers = await this.prisma.supplier.findMany({
        where: {
          id: { in: supplierIds },
          tenantId,
          isActive: true,
        },
      });
      validSuppliers = existingSuppliers.map((s: any, index: number) => ({
        supplierId: s.id,
        discountRate: Number(s.discountRate),
        isPrimary: index === 0,
      }));
    }

    // Auto-calculate costPerItem from best supplier price if suppliers exist
    // Only override costPerItem if it wasn't manually provided and we have supplier prices
    if (validSuppliers.length > 0 && bestSupplierPrice !== null && bestSupplierPrice > 0) {
      // If costPerItem was not provided in update, use the best supplier price
      if (productData.costPerItem === undefined || productData.costPerItem === null || productData.costPerItem === 0) {
        productData.costPerItem = bestSupplierPrice;
        this.logger.log(`💰 Auto-set costPerItem to best supplier price on update: ${bestSupplierPrice}`);
      }
    } else if (validSuppliers.length > 0) {
      // If suppliers exist but no prices provided, don't allow manual costPerItem override
      // Check if product already has suppliers
      const existingSuppliers = await this.prisma.productSupplier.findMany({
        where: { productId: id },
      });
      if (existingSuppliers.length > 0 && productData.costPerItem !== undefined) {
        // If updating suppliers without prices, keep existing costPerItem or calculate from existing supplier prices
        const existingPrices = existingSuppliers
          .filter(s => s.lastPrice !== null)
          .map(s => Number(s.lastPrice));
        if (existingPrices.length > 0) {
          const bestExistingPrice = Math.min(...existingPrices);
          productData.costPerItem = bestExistingPrice;
          this.logger.log(`💰 Using existing best supplier price: ${bestExistingPrice}`);
        }
      }
    }

    // Check SKU uniqueness if provided
    if (productData.sku && productData.sku !== existingProduct.sku) {
      const skuExists = await this.prisma.product.findFirst({
        where: {
          tenantId,
          sku: productData.sku,
          NOT: { id },
        },
      });

      if (skuExists) {
        throw new ConflictException('SKU must be unique within your store');
      }
    }

    // Validate categories exist if provided
    let validCategoryIds: string[] = [];
    if (categoryIds && categoryIds.length > 0) {
      const existingCategories = await this.prisma.category.findMany({
        where: {
          id: { in: categoryIds },
          tenantId: tenantId,
        },
        select: { id: true },
      });

      validCategoryIds = existingCategories.map((cat: { id: any; }) => cat.id);
      
      if (validCategoryIds.length !== categoryIds.length) {
        const invalidCategories = categoryIds.filter(id => !validCategoryIds.includes(id));
        this.logger.warn(`⚠️ Update product: Some categories do not exist or don't belong to tenant: ${invalidCategories.join(', ')}`);
      }
    }

    // Process tags: create or find ProductTag records and prepare tagItems
    let tagItemsData: Array<{ tagId: string }> = [];
    if (tags !== undefined) {
      if (tags.length > 0) {
        this.logger.log(`🏷️ Processing tags for update: ${tags.join(', ')}`);
        
        // Helper function to create slug from tag name
        const createSlug = (name: string): string => {
          return name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
        };

        for (const tagName of tags) {
          if (!tagName || !tagName.trim()) continue;
          
          const tagSlug = createSlug(tagName);
          
          // Find or create ProductTag
          let productTag = await this.prisma.productTag.findUnique({
            where: {
              tenantId_slug: {
                tenantId,
                slug: tagSlug,
              },
            },
          });

          if (!productTag) {
            // Create new tag
            productTag = await this.prisma.productTag.create({
              data: {
                tenantId,
                name: tagName.trim(),
                slug: tagSlug,
              },
            });
            this.logger.log(`✅ Created new tag: ${productTag.name} (${productTag.slug})`);
          }

          tagItemsData.push({ tagId: productTag.id });
        }
      }
      // If tags is an empty array, tagItemsData will remain empty, which will clear all tags
    }

    // Smarter variants update to avoid breaking foreign keys (orders/carts)
    let variantsUpdate: any = undefined;
    if (variants !== undefined) {
      // Get current variants
      const currentVariants = await this.prisma.productVariant.findMany({
        where: { productId: id },
      });

      // If we have existing variants and we're receiving exactly one 'Default' variant
      if (currentVariants.length === 1 && variants.length === 1 && (variants[0].name === 'Default' || !variants[0].name)) {
        variantsUpdate = {
          update: {
            where: { id: currentVariants[0].id },
            data: {
              name: variants[0].name || 'Default',
              sku: variants[0].sku,
              price: variants[0].price,
              compareAtPrice: variants[0].compareAtPrice,
              inventoryQuantity: variants[0].inventoryQuantity,
            },
          },
        };
      } else {
        // Fallback to destructive if we have multiple variants or complex changes
        variantsUpdate = {
          deleteMany: {},
          create: variants.map(variant => ({
            ...variant,
          })),
        };
      }
    }

    try {
      // Log productCode if provided
      if (productData.productCode !== undefined) {
        this.logger.log(`📝 Updating product ${id} with productCode: ${productData.productCode || '(empty - will be cleared)'}`);
      }
      
      const product = await this.prisma.product.update({
        where: { id },
        data: {
          ...productData,
          // Handle brand update
          ...(brandId !== undefined && {
            brand: brandId ? { connect: { id: brandId } } : { disconnect: true },
          }),
          // Handle unit update
          ...(unitId !== undefined && {
            unit: unitId ? { connect: { id: unitId } } : { disconnect: true },
          }),
          variants: variantsUpdate,
          // Always update images if provided
          ...(images !== undefined && {
            images: {
              deleteMany: {}, // Remove existing images
              create: images.map((image, index) => ({
                ...image,
                sortOrder: image.sortOrder || index,
              })),
            },
          }),
          // Always update categories if provided (even if empty array to clear categories)
          ...(categoryIds !== undefined && {
            categories: {
              deleteMany: {}, // Remove existing categories
              ...(validCategoryIds.length > 0 && {
                create: validCategoryIds.map(categoryId => ({
                  category: {
                    connect: { id: categoryId },
                  },
                })),
              }),
            },
          }),
          // Always update tags if provided (even if empty array to clear tags)
          ...(tags !== undefined && {
            tagItems: {
              deleteMany: {}, // Remove existing tags
              ...(tagItemsData.length > 0 && {
                create: tagItemsData,
              }),
            },
          }),
          // Update suppliers if provided
          ...((suppliers !== undefined || supplierIds !== undefined) && {
            suppliers: {
              deleteMany: {}, // Remove existing suppliers
              ...(validSuppliers.length > 0 && {
                create: validSuppliers.map(s => {
                  this.logger.debug(`Adding supplier ${s.supplierId} with code: ${s.supplierProductCode}`);
                  return {
                    supplierId: s.supplierId,
                    discountRate: s.discountRate,
                    isPrimary: s.isPrimary,
                    cost: s.cost ? new Decimal(s.cost) : undefined,
                    supplierProductCode: s.supplierProductCode,
                    lastPrice: s.cost ? new Decimal(s.cost) : (s.price ? new Decimal(s.price) : undefined),
                    lastPriceCheck: (s.cost || s.price) ? new Date() : undefined,
                  };
                }),
              }),
            },
          }),
        },
        include: {
          variants: true,
          images: {
            orderBy: {
              sortOrder: 'asc',
            },
          },
          categories: {
            include: {
              category: true,
            },
          },
          tagItems: {
            include: {
              tag: true,
            },
          },
          suppliers: {
            include: {
              supplier: true,
            },
          },
          brand: true,
          unit: true,
        },
      });

      this.logger.log(`✅ Product updated successfully: ${id}`);
      return this.mapToResponseDto(product);
    } catch (error: any) {
      this.logger.error(`❌ Product update failed for tenant ${tenantId}. Product ID: ${id}`, {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
        stack: error?.stack
      });
      
      // Handle known Prisma errors
      if (error?.code === 'P2003') {
        throw new BadRequestException('Cannot update product: One or more related records (categories, suppliers, or variants) could not be modified because they are referenced by other data (like orders or carts).');
      }
      
      if (error?.code === 'P2002') {
        throw new ConflictException('A product or variant with this SKU already exists in your store.');
      }

      throw error;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    this.logger.log(`🗑️ Attempting to delete product: ${id} for tenant: ${tenantId}`);

    // Ensure tenant exists
    await this.tenantSyncService.ensureTenantExists(tenantId);

    // Find the product first to verify it exists and belongs to the tenant
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });

    if (!product) {
      this.logger.warn(`⚠️ Product not found: ${id} for tenant: ${tenantId}`);
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    this.logger.log(`✅ Product found: ${product.id} - ${product.name || product.nameAr || 'Unnamed'}`);

    try {
      // Delete all related records in a transaction to avoid foreign key constraint violations
      await this.prisma.$transaction(async (tx: any) => {
        // Delete cart items first (no cascade delete)
        const cartItemsDeleted = await tx.cartItem.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${cartItemsDeleted.count} cart items`);

        // Delete order items (no cascade delete)
        const orderItemsDeleted = await tx.orderItem.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${orderItemsDeleted.count} order items`);

        // Delete product collection items (no cascade delete)
        const collectionItemsDeleted = await tx.productCollectionItem.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${collectionItemsDeleted.count} collection items`);

        // Delete product tag items (no cascade delete)
        const tagItemsDeleted = await tx.productTagItem.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${tagItemsDeleted.count} tag items`);

        // Delete product variants
        const variantsDeleted = await tx.productVariant.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${variantsDeleted.count} variants`);

        // Delete product images
        const imagesDeleted = await tx.productImage.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${imagesDeleted.count} images`);

        // Delete product-category associations
        const categoriesDeleted = await tx.productCategory.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${categoriesDeleted.count} category associations`);

        // Delete product-supplier associations
        const suppliersDeleted = await tx.productSupplier.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${suppliersDeleted.count} supplier associations`);

        // Delete card inventory (even though it has cascade delete, we'll delete explicitly for safety)
        const cardInventoryDeleted = await tx.cardInventory.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${cardInventoryDeleted.count} card inventory items`);

        // Delete product price history (even though it has cascade delete, we'll delete explicitly for safety)
        const priceHistoryDeleted = await tx.productPriceHistory.deleteMany({
          where: { productId: id },
        });
        this.logger.log(`  Deleted ${priceHistoryDeleted.count} price history records`);

        // Finally, delete the product
        // Note: We already verified the product belongs to this tenant above
        const deletedProduct = await tx.product.delete({
          where: { id },
        });
        this.logger.log(`  Deleted product: ${deletedProduct.id}`);
      });

      // Verify the product was actually deleted
      const verifyDeleted = await this.prisma.product.findFirst({
        where: { id, tenantId },
      });

      if (verifyDeleted) {
        this.logger.error(`❌ Product still exists after deletion attempt: ${id}`);
        throw new Error(`Failed to delete product ${id} - product still exists in database`);
      }

      this.logger.log(`✅ Product deleted successfully and verified: ${id}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to delete product ${id}:`, error);
      this.logger.error(`Error details:`, {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
        stack: error?.stack,
      });
      
      // Provide more user-friendly error messages
      if (error?.code === 'P2003') {
        // Foreign key constraint violation
        throw new BadRequestException(
          `Cannot delete product: it is still referenced by other records. Please check for related orders, cart items, or inventory records.`
        );
      } else if (error?.code === 'P2025') {
        // Record not found
        throw new NotFoundException(`Product ${id} not found`);
      } else if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        // Re-throw known exceptions as-is
        throw error;
      } else {
        // Wrap unknown errors with more context
        const errorMessage = error?.message || 'Unknown error occurred';
        this.logger.error(`Unexpected error during product deletion: ${errorMessage}`);
        throw new Error(`Failed to delete product: ${errorMessage}`);
      }
    }
  }

  async bulkRemove(
    tenantId: string,
    ids: string[],
  ): Promise<{ deleted: number; failed: number; errors: string[] }> {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    if (!ids || ids.length === 0) {
      throw new BadRequestException('No product IDs provided');
    }

    // Ensure tenant exists once before starting
    await this.tenantSyncService.ensureTenantExists(tenantId);

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process sequentially using the same logic as single delete
    for (const rawId of ids) {
      // Clean the ID similarly to previous implementation
      let cleanId = rawId.trim();
      if (cleanId.includes('/') || cleanId.includes('+')) {
        const parts = cleanId.split(/[/+]/);
        const validParts = parts.filter((part) => {
          const trimmed = part.trim();
          return (
            trimmed.length >= 20 &&
            !trimmed.includes('/') &&
            !trimmed.includes('+')
          );
        });
        if (validParts.length > 0) {
          cleanId = validParts.reduce((a, b) => (a.length > b.length ? a : b)).trim();
        }
      }

      try {
        // Reuse the robust single-delete logic
        await this.remove(tenantId, cleanId);
        deleted++;
      } catch (error: any) {
        // If the product is already gone, treat it as a soft success
        if (error instanceof NotFoundException) {
          this.logger.warn(
            `Product ${cleanId} not found during bulk delete (likely already deleted)`,
          );
          errors.push(`Product ${cleanId} not found (maybe already deleted)`);
          continue;
        }

        failed++;
        const message = error?.message || 'Unknown error';
        errors.push(`Failed to delete product ${cleanId}: ${message}`);
        this.logger.error(`Failed to delete product ${cleanId}:`, error);
      }
    }

    this.logger.log(`✅ Bulk delete completed: ${deleted} deleted, ${failed} failed`);
    return { deleted, failed, errors };
  }

  async updateInventory(tenantId: string, variantId: string, quantity: number): Promise<void> {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    // Ensure tenant exists
    await this.tenantSyncService.ensureTenantExists(tenantId);

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        product: {
          tenantId,
        },
      },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { inventoryQuantity: quantity },
    });
  }

  private mapToResponseDto(product: any): ProductResponseDto {
    const response = {
      id: product.id,
      tenantId: product.tenantId,
      name: product.name,
      description: product.description,
      sku: product.sku,
      price: Number(product.price),
      compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : undefined,
      costPerItem: product.costPerItem ? Number(product.costPerItem) : undefined,
      isAvailable: product.isAvailable,
      isPublished: product.isPublished,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      nameAr: product.nameAr,
      descriptionAr: product.descriptionAr,
      barcode: product.barcode,
      featured: product.featured,
      weight: product.weight ? Number(product.weight) : undefined,
      dimensions: product.dimensions,
      coinsNumber: product.coinsNumber,
      notify: product.notify,
      min: product.min,
      max: product.max,
      webStatus: product.webStatus,
      mobileStatus: product.mobileStatus,
      enableSlider: product.enableSlider,
      sliderStep: product.sliderStep,
      sliderStepMode: product.sliderStepMode,
      featuredPriceIncrease: product.featuredPriceIncrease ? Number(product.featuredPriceIncrease) : undefined,
      featuredPriceCurrency: product.featuredPriceCurrency,
      purpleCardsProductNameAr: product.purpleCardsProductNameAr,
      purpleCardsProductNameEn: product.purpleCardsProductNameEn,
      purpleCardsSlugAr: product.purpleCardsSlugAr,
      purpleCardsSlugEn: product.purpleCardsSlugEn,
      purpleCardsDescAr: product.purpleCardsDescAr,
      purpleCardsDescEn: product.purpleCardsDescEn,
      purpleCardsLongDescAr: product.purpleCardsLongDescAr,
      purpleCardsLongDescEn: product.purpleCardsLongDescEn,
      purpleCardsMetaTitleAr: product.purpleCardsMetaTitleAr,
      purpleCardsMetaTitleEn: product.purpleCardsMetaTitleEn,
      purpleCardsMetaKeywordAr: product.purpleCardsMetaKeywordAr,
      purpleCardsMetaKeywordEn: product.purpleCardsMetaKeywordEn,
      purpleCardsMetaDescriptionAr: product.purpleCardsMetaDescriptionAr,
      purpleCardsMetaDescriptionEn: product.purpleCardsMetaDescriptionEn,
      ish7enProductNameAr: product.ish7enProductNameAr,
      ish7enProductNameEn: product.ish7enProductNameEn,
      ish7enSlugAr: product.ish7enSlugAr,
      ish7enSlugEn: product.ish7enSlugEn,
      ish7enDescAr: product.ish7enDescAr,
      ish7enDescEn: product.ish7enDescEn,
      ish7enLongDescAr: product.ish7enLongDescAr,
      ish7enLongDescEn: product.ish7enLongDescEn,
      ish7enMetaTitleAr: product.ish7enMetaTitleAr,
      ish7enMetaTitleEn: product.ish7enMetaTitleEn,
      ish7enMetaKeywordAr: product.ish7enMetaKeywordAr,
      ish7enMetaKeywordEn: product.ish7enMetaKeywordEn,
      ish7enMetaDescriptionAr: product.ish7enMetaDescriptionAr,
      ish7enMetaDescriptionEn: product.ish7enMetaDescriptionEn,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      variants: product.variants?.map((variant: any) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        price: Number(variant.price),
        compareAtPrice: variant.compareAtPrice ? Number(variant.compareAtPrice) : undefined,
        inventoryQuantity: variant.inventoryQuantity,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      })),
      images: product.images?.map((image: any) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        sortOrder: image.sortOrder,
        createdAt: image.createdAt,
      })),
      categories: product.categories?.map((pc: any) => ({
        ...pc.category,
        priceExceed: pc.category?.priceExceed || false,
      })).filter((c: any) => !!c.id && c.isActive), // Filter out null or inactive categories
      productId: product.productId,
      productCode: product.productCode,
      odooProductId: product.odooProductId,
      priceExceed: product.priceExceed,
      brand: product.brand ? {
        id: product.brand.id,
        name: product.brand.name,
        nameAr: product.brand.nameAr,
        code: product.brand.code,
        priceExceed: product.brand.priceExceed,
      } : undefined,
      suppliers: product.suppliers?.map((ps: any) => {
        if (!ps.supplier) return null;
        return {
          id: ps.id,
          supplierId: ps.supplierId,
          supplier: {
            id: ps.supplier.id,
            name: ps.supplier.name,
            nameAr: ps.supplier.nameAr,
            discountRate: Number(ps.supplier.discountRate || 0),
          },
          discountRate: Number(ps.discountRate || 0),
          isPrimary: ps.isPrimary,
          cost: ps.cost ? Number(ps.cost) : undefined,
          supplierProductCode: ps.supplierProductCode,
          lastPrice: ps.lastPrice ? Number(ps.lastPrice) : undefined,
          lastPriceCheck: ps.lastPriceCheck,
        };
      }).filter((s: any) => s !== null),
      unit: product.unit ? {
        id: product.unit.id,
        name: product.unit.name,
        nameAr: product.unit.nameAr,
        code: product.unit.code,
        symbol: product.unit.symbol,
        cost: Number(product.unit.cost),
      } : undefined,
    };

    this.logger.debug(`Mapped product ${product.id}: price=${response.price}, images=${response.images?.length || 0}, variants=${response.variants?.length || 0}`);
    
    return response;
  }
}
import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

export interface CreateCardProductDto {
  brandId?: string;
  categoryId?: string;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  image?: string;
  productCode?: string;
  denomination: number;
  currency?: string;
  wholesalePrice: number;
  retailPrice: number;
  profitMargin?: number;
  taxRate?: number;
  isActive?: boolean;
  minQuantity?: number;
  maxQuantity?: number;
  sortOrder?: number;
}

export interface UpdateCardProductDto extends Partial<CreateCardProductDto> {
  isAvailable?: boolean;
  stockCount?: number;
}

export interface CardProductFilter {
  brandId?: string;
  categoryId?: string;
  isActive?: boolean;
  isAvailable?: boolean;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
}

@Injectable()
export class CardProductService {
  private readonly logger = new Logger(CardProductService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private cloudinaryService: CloudinaryService
  ) {}


  async create(tenantId: string, data: CreateCardProductDto) {
    // Check for duplicate product code
    if (data.productCode) {
      const existing = await this.prisma.product.findFirst({
        where: {
          tenantId,
          productCode: data.productCode,
        },
      });
      if (existing) {
        throw new ConflictException(`Product with code ${data.productCode} already exists`);
      }
    }


    const product = await this.prisma.product.create({
      data: {
        tenantId,
        brandId: data.brandId,
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        productCode: data.productCode,
        price: data.retailPrice,
        costPerItem: data.wholesalePrice,
        isAvailable: data.isActive ?? true,
        min: data.minQuantity || 1,
        max: data.maxQuantity || 100,
      },
      include: {
        brand: true,
      },
    });


    this.logger.log(`Created card product ${product.id}: ${product.name}`);

    // Handle image renaming if it is a Cloudinary URL
    if (data.image && data.image.includes('cloudinary.com')) {
      const newImageUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
        data.image,
        `card_product_${product.id}`
      );
      if (newImageUrl !== data.image) {
        // CardProduct model has an 'image' field, but the 'create' above was actually on the 'product' table? 
        // Wait, let's check if the return 'product' is from 'this.prisma.product.create' or 'this.prisma.cardProduct.create'
        // In the 'create' method above (lines 67-85), it uses 'this.prisma.product.create'.
        // This is confusing as 'CardProduct' is a separate model in the schema.
        // Let's check which one it should be.
        
        // If it's the 'product' table, we need to add a record to 'ProductImage' or update a field if it exists.
        // But the schema for 'Product' doesn't have an 'image' field, it has 'images' relation.
        // The 'CardProduct' model DOES have an 'image' field.
        
        // Actually, looking at 'findOne' (line 155), it takes 'product.images?.[0]?.url'.
        // So for 'product' table, we update 'ProductImage'.
        const firstImage = await this.prisma.productImage.findFirst({
           where: { productId: product.id },
           orderBy: { sortOrder: 'asc' }
        });
        
        if (firstImage) {
          await this.prisma.productImage.update({
            where: { id: firstImage.id },
            data: { url: newImageUrl }
          });
        } else {
          await this.prisma.productImage.create({
            data: {
              productId: product.id,
              url: newImageUrl,
              sortOrder: 0
            }
          });
        }
      }
    }

    return product;
  }

  async findAll(
    tenantId: string,
    filter: CardProductFilter = {},
    page: number = 1,
    limit: number = 20,
  ) {
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          tenantId,
          brandId: filter.brandId,
          isAvailable: filter.isActive,
          OR: filter.search ? [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { nameAr: { contains: filter.search, mode: 'insensitive' } },
            { productCode: { contains: filter.search, mode: 'insensitive' } },
          ] : undefined,
        },
        include: {
          brand: true,
          images: { take: 1 },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where: { tenantId } }),
    ]);


    // Add available stock count to each product
    const productsWithStock = products.map((product) => ({
      ...product,
      availableStock: product._count.inventory,
    }));

    return {
      data: productsWithStock,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        brand: true,
        images: { take: 1 },
      },
    });


    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return {
      ...product,
      wholesalePrice: Number(product.costPerItem || product.price),
      retailPrice: Number(product.price),
      image: product.images?.[0]?.url || null,
      availableStock: product.isAvailable ? 999 : 0,
      minQuantity: product.min || 1,
      maxQuantity: product.max || 1000,
      taxRate: 0.15,
    };

  }

  async update(tenantId: string, id: string, data: UpdateCardProductDto) {
    await this.findOne(tenantId, id);

    const product = await this.prisma.cardProduct.update({
      where: { id },
      data,
      include: {
        brand: true,
        category: true,
      },
    });

    this.logger.log(`Updated card product ${product.id}: ${product.name}`);

    // Handle image renaming if it is a Cloudinary URL
    if (product.image && product.image.includes('cloudinary.com')) {
      const newImageUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
        product.image,
        `card_product_${product.id}`
      );
      if (newImageUrl !== product.image) {
        return await this.prisma.cardProduct.update({
          where: { id: product.id },
          data: { image: newImageUrl },
          include: {
            brand: true,
            category: true,
          },
        });
      }
    }

    return product;
  }

  async delete(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    await this.prisma.cardProduct.delete({
      where: { id },
    });

    this.logger.log(`Deleted card product ${id}`);
    return { success: true };
  }

  // Update stock count based on inventory
  async updateStockCount(productId: string) {
    const count = await this.prisma.cardInventory.count({
      where: { productId, status: 'AVAILABLE' },
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        stockCount: count,
        isAvailable: count > 0,
      },
    });


    // Send low stock notification
    if (count < 5) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, nameAr: true, tenantId: true }
      });

      
      if (product) {
        try {
          await this.notificationsService.sendNotification({
            tenantId: product.tenantId,
            type: 'INVENTORY',
            titleEn: 'Low Stock Alert',
            titleAr: 'تنبيه انخفاض المخزون',
            bodyEn: `Product "${product.name}" is low on stock (${count} remaining).`,
            bodyAr: `المنتج "${product.nameAr || product.name}" مخزونه منخفض (بقي ${count}).`,
            data: { productId, stockCount: count }
          });
        } catch (error) {
          this.logger.error(`Failed to send low stock notification: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return count;
  }

  // Get products by brand
  async findByBrand(tenantId: string, brandId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        brandId,
        isAvailable: true,
      },
      include: {
        brand: true,
        images: { take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return products.map(p => ({
      ...p,
      wholesalePrice: Number(p.costPerItem || p.price),
      retailPrice: Number(p.price),
      image: p.images?.[0]?.url || null,
      availableStock: p.stockCount,
      minQuantity: p.min || 1,
      maxQuantity: p.max || 1000,
    }));
  }


  // Get products by category
  async findByCategory(tenantId: string, categoryId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        categories: { some: { categoryId } },
        isAvailable: true,
      },
      include: {
        brand: true,
        images: { take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return products.map(p => ({
      ...p,
      wholesalePrice: Number(p.costPerItem || p.price),
      retailPrice: Number(p.price),
      image: p.images?.[0]?.url || null,
      availableStock: p.stockCount,
      minQuantity: p.min || 1,
      maxQuantity: p.max || 1000,
    }));
  }


  // Get all brands with product counts
  async getBrandsWithProducts(tenantId: string) {
    const brands = await this.prisma.brand.findMany({
      where: {
        tenantId,
        status: 'Active',
      },
      include: {
        _count: {
          select: {
            products: {
              where: { isAvailable: true },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return brands.map((brand) => ({
      ...brand,
      productCount: brand._count.products,
    }));

  }

  // Get all categories with product counts
  async getCategoriesWithProducts(tenantId: string) {
    const categories = await this.prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      include: {
        _count: {
          select: {
            products: {
              where: {
                product: { isAvailable: true }
              },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return categories.map((category) => ({
      ...category,
      productCount: category._count.products,
    }));

  }
}


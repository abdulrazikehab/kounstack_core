import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSyncService } from '../tenant/tenant-sync.service';

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private prisma: PrismaService,
    private tenantSyncService: TenantSyncService,
  ) {}

  async createCollection(tenantId: string, data: { name: string; description?: string; image?: string }) {
    await this.tenantSyncService.ensureTenantExists(tenantId);
    const slug = this.generateSlug(data.name);

    // Check if collection with same slug exists
    const existingCollection = await this.prisma.productCollection.findFirst({
      where: {
        tenantId,
        slug,
      },
    });

    if (existingCollection) {
      throw new ConflictException('Collection with this name already exists');
    }

    const collection = await this.prisma.productCollection.create({
      data: {
        ...data,
        slug,
        tenantId,
      },
    });

    this.logger.log(`Collection created: ${collection.name} for tenant ${tenantId}`);
    
    return collection;
  }

  async getCollections(tenantId: string, includeProducts: boolean = false) {
    return this.prisma.productCollection.findMany({
      where: { tenantId, isActive: true },
      include: {
        products: includeProducts ? {
          include: {
            product: {
              include: {
                images: { orderBy: { sortOrder: 'asc' }, take: 1 },
                variants: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        } : false,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getCollection(tenantId: string, collectionId: string) {
    const collection = await this.prisma.productCollection.findFirst({
      where: { 
        id: collectionId,
        tenantId,
        isActive: true
      },
      include: {
        products: {
          include: {
            product: {
              include: {
                images: { orderBy: { sortOrder: 'asc' } },
                variants: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!collection) {
      throw new NotFoundException('الخدمة التي تبحث عنها غير متوفرة');
    }

    // Transform the structure to match what frontend expects (matching ProductResponseDto)
    return {
      ...collection,
      products: collection.products.map(cp => ({
        ...cp.product,
        images: cp.product.images.map(img => ({
          id: img.id,
          url: img.url,
          altText: img.altText,
          sortOrder: img.sortOrder
        })),
        variants: cp.product.variants.map(v => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          price: Number(v.price),
          compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
          inventoryQuantity: v.inventoryQuantity,
        })),
        price: Number(cp.product.price),
        compareAtPrice: cp.product.compareAtPrice ? Number(cp.product.compareAtPrice) : undefined,
        sortOrder: cp.sortOrder
      }))
    };
  }

  async addProductToCollection(tenantId: string, collectionId: string, productId: string, sortOrder: number = 0) {
    // Verify collection and product belong to tenant
    const [collection, product] = await Promise.all([
      this.prisma.productCollection.findFirst({
        where: { id: collectionId, tenantId },
      }),
      this.prisma.product.findFirst({
        where: { id: productId, tenantId },
      }),
    ]);

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const collectionItem = await this.prisma.productCollectionItem.upsert({
      where: {
        collectionId_productId: { collectionId, productId },
      },
      create: {
        collectionId,
        productId,
        sortOrder,
      },
      update: {
        sortOrder,
      },
    });

    this.logger.log(`Product ${productId} added to collection ${collectionId}`);
    
    return collectionItem;
  }

  async removeProductFromCollection(tenantId: string, collectionId: string, productId: string) {
    // Verify collection belongs to tenant
    const collection = await this.prisma.productCollection.findFirst({
      where: { id: collectionId, tenantId },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    await this.prisma.productCollectionItem.delete({
      where: {
        collectionId_productId: { collectionId, productId },
      },
    });

    this.logger.log(`Product ${productId} removed from collection ${collectionId}`);
  }

  async updateCollection(tenantId: string, collectionId: string, data: { name?: string; description?: string; image?: string; isActive?: boolean }) {
    const collection = await this.prisma.productCollection.findFirst({
      where: { id: collectionId, tenantId },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    const updateData: any = { ...data };

    // If name changed, update slug
    if (data.name && data.name !== collection.name) {
      updateData.slug = this.generateSlug(data.name);
    }

    const updatedCollection = await this.prisma.productCollection.update({
      where: { id: collectionId },
      data: updateData,
    });

    return updatedCollection;
  }

  async deleteCollection(tenantId: string, collectionId: string) {
    const collection = await this.prisma.productCollection.findFirst({
      where: { id: collectionId, tenantId },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    // Remove all collection items first
    await this.prisma.productCollectionItem.deleteMany({
      where: { collectionId },
    });

    await this.prisma.productCollection.delete({
      where: { id: collectionId },
    });

    this.logger.log(`Collection ${collectionId} deleted for tenant ${tenantId}`);
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
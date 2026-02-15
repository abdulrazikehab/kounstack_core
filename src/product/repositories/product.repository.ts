import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IProductRepository, ProductFilters } from './product.repository.interface';

@Injectable()
export class ProductRepository implements IProductRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, filters?: ProductFilters): Promise<Product[]> {
    const where: any = { tenantId };

    if (filters) {
      // Filter by category through the junction table
      if (filters.categoryId) {
        where.categories = {
          some: {
            categoryId: filters.categoryId,
          },
        };
      }
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ];
      }
      if (filters.minPrice || filters.maxPrice) {
        where.price = {};
        if (filters.minPrice) where.price.gte = filters.minPrice;
        if (filters.maxPrice) where.price.lte = filters.maxPrice;
      }
    }

    return this.prisma.product.findMany({ 
      where,
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        images: true,
        variants: true,
      },
    });
  }

  async findById(id: string, tenantId: string): Promise<Product | null> {
    return this.prisma.product.findFirst({
      where: { id, tenantId },
    });
  }

  async create(data: any, tenantId: string): Promise<Product> {
    return this.prisma.product.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  async update(id: string, data: any, tenantId: string): Promise<Product> {
    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.prisma.product.delete({
      where: { id },
    });
  }

  async count(tenantId: string, filters?: ProductFilters): Promise<number> {
    const where: any = { tenantId };
    
    if (filters) {
      // Filter by category through the junction table
      if (filters.categoryId) {
        where.categories = {
          some: {
            categoryId: filters.categoryId,
          },
        };
      }
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
    }

    return this.prisma.product.count({ where });
  }
}

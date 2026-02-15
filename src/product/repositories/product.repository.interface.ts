import { Product } from '@prisma/client';

export interface ProductFilters {
  categoryId?: string;
  search?: string;
  isActive?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

export interface IProductRepository {
  findAll(tenantId: string, filters?: ProductFilters): Promise<Product[]>;
  findById(id: string, tenantId: string): Promise<Product | null>;
  create(data: any, tenantId: string): Promise<Product>;
  update(id: string, data: any, tenantId: string): Promise<Product>;
  delete(id: string, tenantId: string): Promise<void>;
  count(tenantId: string, filters?: ProductFilters): Promise<number>;
}

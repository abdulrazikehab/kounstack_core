// apps/app-core/src/supplier/supplier.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierAdapterFactory } from './integrations/supplier-adapter.factory';
import { SupplierAdapter } from './integrations/supplier-adapter.interface';
import { SupplierType } from '@prisma/client';

export interface CreateSupplierDto {
  name: string;
  nameAr?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  address?: string;
  discountRate?: number;
  notes?: string;
  supplierType?: SupplierType;
  provider?: string;
  // API Configuration
  apiEndpoint?: string;
  apiKey?: string;
  apiConfig?: any;
  autoPurchaseEnabled?: boolean;
  priceCheckInterval?: number;
  responseDays?: number; // Days supplier takes to respond to problems
}

export interface UpdateSupplierDto {
  name?: string;
  nameAr?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  address?: string;
  discountRate?: number;
  isActive?: boolean;
  notes?: string;
  supplierType?: SupplierType;
  provider?: string;
  // API Configuration
  apiEndpoint?: string;
  apiKey?: string;
  apiConfig?: any;
  autoPurchaseEnabled?: boolean;
  priceCheckInterval?: number;
  responseDays?: number; // Days supplier takes to respond to problems
}

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: SupplierAdapterFactory
  ) {}

  async create(tenantId: string, data: CreateSupplierDto) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: data.name,
        nameAr: data.nameAr,
        email: data.email,
        phone: data.phone,
        contactPerson: data.contactPerson,
        address: data.address,
        discountRate: data.discountRate || 0,
        notes: data.notes,
        supplierType: data.supplierType || 'CUSTOM',
        provider: data.provider,
        apiEndpoint: data.apiEndpoint,
        apiKey: data.apiKey,
        apiConfig: data.apiConfig,
        autoPurchaseEnabled: data.autoPurchaseEnabled || false,
        priceCheckInterval: data.priceCheckInterval,
        responseDays: data.responseDays || 3,
      },
    });

    this.logger.log(`Supplier created: ${supplier.id} for tenant ${tenantId}`);
    return supplier;
  }

  async findAll(tenantId: string, includeInactive: boolean = false) {
    try {
      if (!tenantId) {
        this.logger.error('findAll called with null/undefined tenantId');
        throw new BadRequestException('Tenant ID is required');
      }

      const where: any = { tenantId };
      if (!includeInactive) {
        where.isActive = true;
      }

      return await this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch (error: any) {
      this.logger.error(`Error in findAll suppliers for tenant ${tenantId}:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch suppliers: ${error?.message || 'Unknown error'}`);
    }
  }

  async findOne(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async update(tenantId: string, id: string, data: UpdateSupplierDto) {
    const supplier = await this.findOne(tenantId, id);

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        email: data.email,
        phone: data.phone,
        contactPerson: data.contactPerson,
        address: data.address,
        discountRate: data.discountRate,
        isActive: data.isActive,
        notes: data.notes,
        supplierType: data.supplierType,
        provider: data.provider,
        apiEndpoint: data.apiEndpoint,
        apiKey: data.apiKey,
        apiConfig: data.apiConfig,
        autoPurchaseEnabled: data.autoPurchaseEnabled,
        priceCheckInterval: data.priceCheckInterval,
        responseDays: data.responseDays,
      },
    });

    this.logger.log(`Supplier updated: ${id}`);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    // Check if supplier is used in any products
    const productCount = await this.prisma.productSupplier.count({
      where: {
        supplierId: id,
        product: {
          tenantId,
        },
      },
    });

    if (productCount > 0) {
      // Soft delete by setting isActive to false
      const updated = await this.prisma.supplier.update({
        where: { id },
        data: { isActive: false },
      });
      this.logger.log(`Supplier soft deleted (deactivated): ${id} - used in ${productCount} products`);
      return updated;
    }

    await this.prisma.supplier.delete({
      where: { id },
    });

    this.logger.log(`Supplier hard deleted: ${id}`);
    return { id, deleted: true };
  }

  /**
   * Get supplier adapter for API operations
   */
  private async getAdapter(supplierId: string, tenantId: string): Promise<SupplierAdapter> {
    const supplier = await this.findOne(tenantId, supplierId);
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return this.adapterFactory.createAdapter(supplier);
  }

  /**
   * Check supplier balance
   */
  async checkBalance(tenantId: string, supplierId: string) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    return adapter.checkBalance();
  }

  /**
   * Get products from supplier
   */
  async getSupplierProducts(tenantId: string, supplierId: string, merchantId?: string) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    return adapter.getProducts(merchantId);
  }

  /**
   * Get product details from supplier
   */
  async getSupplierProductDetails(tenantId: string, supplierId: string, productId: string) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    return adapter.getProductDetails(productId);
  }

  /**
   * Test supplier connection
   */
  async testConnection(tenantId: string, supplierId: string) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    return adapter.testConnection();
  }

  /**
   * Purchase product from supplier
   */
  async purchaseFromSupplier(
    tenantId: string,
    supplierId: string,
    request: {
      productId: string;
      quantity?: number;
      resellerRefNumber: string;
      terminalId?: string;
      inquireReferenceNumber?: string;
      inputParameters?: Record<string, string>;
      sellPrice?: number; // Optional sell price for Supplier Hub
      currency?: string; // Optional currency for Supplier Hub
    }
  ) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });

    // For Supplier Hub, we need to pass sell_price
    if (supplier?.supplierType === 'SUPPLIER_HUB') {
      const { SupplierHubAdapter } = await import('./integrations/supplier-hub.adapter');
      
      // Get product price if not provided
      let sellPrice = request.sellPrice;
      let currency = request.currency || 'USD';

      if (!sellPrice) {
        const product = await this.prisma.product.findFirst({
          where: { id: request.productId, tenantId },
        });
        if (product) {
          sellPrice = Number(product.price);
          currency = 'USD'; // Default currency
        } else {
          throw new NotFoundException(`Product ${request.productId} not found`);
        }
      }

      // Cast to SupplierHubAdapter to access the extended method
      const hubAdapter = adapter as any;
      if (hubAdapter.purchaseProduct && hubAdapter.constructor.name === 'SupplierHubAdapter') {
        return hubAdapter.purchaseProduct(
          {
            productId: request.productId,
            quantity: request.quantity,
            resellerRefNumber: request.resellerRefNumber,
            terminalId: request.terminalId,
            inquireReferenceNumber: request.inquireReferenceNumber,
            inputParameters: request.inputParameters,
          },
          sellPrice,
          currency,
        );
      }
    }

    // For other adapters, use standard interface
    return adapter.purchaseProduct({
      productId: request.productId,
      quantity: request.quantity,
      resellerRefNumber: request.resellerRefNumber,
      terminalId: request.terminalId,
      inquireReferenceNumber: request.inquireReferenceNumber,
      inputParameters: request.inputParameters,
    });
  }

  /**
   * Check transaction status
   */
  async checkTransactionStatus(tenantId: string, supplierId: string, resellerRefNumber: string) {
    const adapter = await this.getAdapter(supplierId, tenantId);
    return adapter.checkTransactionStatus(resellerRefNumber);
  }
}


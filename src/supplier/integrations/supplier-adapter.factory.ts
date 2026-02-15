// Factory to create supplier adapters based on supplier type
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupplierAdapter } from './supplier-adapter.interface';
import { BitaqatyBusinessService } from './bitaqaty-business.service';
import { BitaqatyAdapter } from './bitaqaty-adapter';
import { SupplierHubAdapter } from './supplier-hub.adapter';
import { SupplierHubClient } from './supplier-hub.client';
import { Supplier } from '@prisma/client';

export interface SupplierConfig {
  resellerUsername?: string;
  secretKey?: string;
  environment?: 'staging' | 'production';
  merchantId?: string;
  // Supplier Hub config
  supplierHubBaseUrl?: string;
  supplierHubApiKey?: string;
  supplierPriority?: string[];
  [key: string]: any; // Allow additional config fields
}

/**
 * Adapter for manual/custom suppliers that don't have an API integration
 */
class ManualSupplierAdapter implements SupplierAdapter {
  async checkBalance(): Promise<{ balance: number; currency: string }> {
    return { balance: 0, currency: 'N/A' };
  }

  async getProducts(): Promise<any[]> {
    return [];
  }

  async getProductDetails(productId: string): Promise<any> {
    throw new BadRequestException(`API integration not configured for this supplier.`);
  }

  async checkProductAvailability(productId: string): Promise<boolean> {
    return false;
  }

  async purchaseProduct(request: any): Promise<any> {
    throw new BadRequestException(`API integration not configured for this supplier.`);
  }

  async checkTransactionStatus(resellerRefNumber: string): Promise<any> {
    throw new BadRequestException(`API integration not configured for this supplier.`);
  }

  async testConnection(): Promise<boolean> {
    return true; // Manual suppliers are "connected" as long as they exist
  }
}

@Injectable()
export class SupplierAdapterFactory {
  private readonly logger = new Logger(SupplierAdapterFactory.name);

  constructor(
    private bitaqatyService: BitaqatyBusinessService,
    private supplierHubClient: SupplierHubClient,
  ) {}

  /**
   * Create supplier adapter based on supplier type
   */
  createAdapter(supplier: Supplier): SupplierAdapter {
    const apiConfig = (supplier.apiConfig || {}) as SupplierConfig;

    switch (supplier.supplierType) {
      case 'BITAQATY_BUSINESS':
        if (!apiConfig.resellerUsername || !apiConfig.secretKey) {
          throw new BadRequestException(
            'Bitaqaty Business requires resellerUsername and secretKey in apiConfig'
          );
        }

        return new BitaqatyAdapter(this.bitaqatyService, {
          resellerUsername: apiConfig.resellerUsername,
          secretKey: apiConfig.secretKey,
          environment: apiConfig.environment || 'staging',
          merchantId: apiConfig.merchantId,
        });

      case 'SUPPLIER_HUB':
        if (!apiConfig.supplierHubBaseUrl || !apiConfig.supplierHubApiKey) {
          throw new BadRequestException(
            'Supplier Hub requires supplierHubBaseUrl and supplierHubApiKey in apiConfig'
          );
        }

        // Create a new adapter instance for each supplier
        const adapter = new SupplierHubAdapter(this.supplierHubClient);
        adapter.initialize(
          {
            baseUrl: apiConfig.supplierHubBaseUrl,
            apiKey: apiConfig.supplierHubApiKey,
            timeout: 30000,
          },
          apiConfig.supplierPriority || ['ONECARD', 'WUPEX', 'BAMBOO'],
        );
        return adapter;

      case 'CUSTOM':
      default:
        return new ManualSupplierAdapter();
    }
  }

  /**
   * Check if supplier type is supported
   */
  isSupported(supplierType: string): boolean {
    return ['BITAQATY_BUSINESS', 'SUPPLIER_HUB', 'CUSTOM'].includes(supplierType);
  }
}


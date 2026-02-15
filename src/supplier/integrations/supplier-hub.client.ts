import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface SupplierHubConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export interface CreateOrderRequest {
  order_ref: string;
  product_code: string;
  quantity: number;
  sell_price: number;
  currency: string;
  supplier_priority: string[];
  metadata?: Record<string, any>;
}

export interface CreateOrderResponse {
  status: 'success' | 'failed';
  order_ref: string;
  supplier?: string;
  supplier_cost?: number;
  sell_price?: number;
  profit_margin?: number;
  deliverables?: Array<{
    type: string;
    key: string;
    value: string;
    extra?: any;
  }>;
  code?: string;
  message?: string;
  loss_amount?: number;
  attempts?: Array<{
    supplier: string;
    error: string;
    timestamp: string;
  }>;
  created_at: string;
}

export interface GetOrderResponse {
  order_ref: string;
  status: 'success' | 'failed';
  supplier?: string;
  supplier_cost?: number;
  sell_price?: number;
  deliverables?: Array<{
    type: string;
    key: string;
    value: string;
    extra?: any;
  }>;
  code?: string;
  message?: string;
  created_at: string;
  updated_at?: string;
}

export interface ProductInfo {
  product_code: string;
  name: string;
  category?: string;
  supplier?: string;
  cost_price: number;
  suggested_sell_price?: number;
  available: boolean;
  currency: string;
}

@Injectable()
export class SupplierHubClient {
  private readonly logger = new Logger(SupplierHubClient.name);
  private config: SupplierHubConfig | null = null;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Initialize Supplier Hub client with configuration
   */
  initialize(config: SupplierHubConfig): void {
    // Normalize baseUrl to use saeaa.net if kawn.net is provided (migration fallback)
    let baseUrl = config.baseUrl;
    if (baseUrl && baseUrl.includes('kawn.net')) {
      const oldUrl = baseUrl;
      baseUrl = baseUrl.replace('kawn.net', 'saeaa.net');
      this.logger.log(`🔄 Normalizing Supplier Hub baseUrl: ${oldUrl} -> ${baseUrl}`);
    }

    this.config = {
      ...config,
      baseUrl,
      timeout: config.timeout || 30000,
    };
    this.logger.log('Supplier Hub client initialized');
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.config !== null;
  }

  /**
   * Create a new order via Supplier Hub
   */
  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
    if (!this.config) {
      throw new Error('Supplier Hub client not initialized. Call initialize() first.');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<CreateOrderResponse>(
          `${this.config.baseUrl}/api/v1/orders`,
          request,
          {
            headers: {
              'X-API-KEY': this.config.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: this.config.timeout,
          },
        ),
      );

      this.logger.log(
        `Order ${request.order_ref} created via Supplier Hub. Status: ${response.data.status}`,
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AxiosError) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          'Unknown error from Supplier Hub';
        const errorCode = error.response?.data?.code || 'UNKNOWN_ERROR';

        this.logger.error(
          `Supplier Hub API error for order ${request.order_ref}: ${errorMessage} (${errorCode})`,
        );

        // Return a failed response structure
        return {
          status: 'failed',
          order_ref: request.order_ref,
          code: errorCode,
          message: errorMessage,
          created_at: new Date().toISOString(),
        };
      }

      this.logger.error(`Unexpected error creating order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get order details by order_ref
   */
  async getOrder(orderRef: string): Promise<GetOrderResponse> {
    if (!this.config) {
      throw new Error('Supplier Hub client not initialized. Call initialize() first.');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<GetOrderResponse>(
          `${this.config.baseUrl}/api/v1/orders/${orderRef}`,
          {
            headers: {
              'X-API-KEY': this.config.apiKey,
            },
            timeout: this.config.timeout,
          },
        ),
      );

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          'Unknown error from Supplier Hub';
        this.logger.error(`Error fetching order ${orderRef}: ${errorMessage}`);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  /**
   * Get order status (quick check)
   */
  async getOrderStatus(orderRef: string): Promise<{ status: string; code?: string }> {
    if (!this.config) {
      throw new Error('Supplier Hub client not initialized. Call initialize() first.');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ status: string; code?: string }>(
          `${this.config.baseUrl}/api/v1/orders/${orderRef}/status`,
          {
            headers: {
              'X-API-KEY': this.config.apiKey,
            },
            timeout: this.config.timeout,
          },
        ),
      );

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          'Unknown error from Supplier Hub';
        this.logger.error(`Error fetching order status ${orderRef}: ${errorMessage}`);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  /**
   * Get available products
   */
  async getAvailableProducts(
    category?: string,
    supplier?: string,
  ): Promise<ProductInfo[]> {
    if (!this.config) {
      throw new Error('Supplier Hub client not initialized. Call initialize() first.');
    }

    try {
      const params: Record<string, string> = {};
      if (category) params.category = category;
      if (supplier) params.supplier = supplier;

      const response = await firstValueFrom(
        this.httpService.get<ProductInfo[]>(
          `${this.config.baseUrl}/api/v1/products/available`,
          {
            headers: {
              'X-API-KEY': this.config.apiKey,
            },
            params,
            timeout: this.config.timeout,
          },
        ),
      );

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          'Unknown error from Supplier Hub';
        this.logger.error(`Error fetching products: ${errorMessage}`);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; suppliers?: any }> {
    if (!this.config) {
      throw new Error('Supplier Hub client not initialized. Call initialize() first.');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ status: string; suppliers?: any }>(
          `${this.config.baseUrl}/api/v1/health`,
          {
            timeout: 5000, // Shorter timeout for health check
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Supplier Hub health check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Map supplier name/code to Supplier Hub supplier code
   */
  static mapSupplierToHubCode(supplierName: string): string {
    const mapping: Record<string, string> = {
      onecard: 'ONECARD',
      'one-card': 'ONECARD',
      one_card: 'ONECARD',
      ONECARD: 'ONECARD',
      wupex: 'WUPEX',
      WUPEX: 'WUPEX',
      bamboo: 'BAMBOO',
      BAMBOO: 'BAMBOO',
    };

    return mapping[supplierName.toUpperCase()] || supplierName.toUpperCase();
  }
}


import { Injectable, Logger } from '@nestjs/common';
import {
  SupplierAdapter,
  SupplierBalance,
  SupplierProduct,
  SupplierPurchaseRequest,
  SupplierPurchaseResponse,
} from './supplier-adapter.interface';
import {
  SupplierHubClient,
  SupplierHubConfig,
  CreateOrderRequest,
  CreateOrderResponse,
} from './supplier-hub.client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SupplierHubAdapter implements SupplierAdapter {
  private readonly logger = new Logger(SupplierHubAdapter.name);
  private client: SupplierHubClient;
  private config: SupplierHubConfig | null = null;
  private supplierPriority: string[] = [];

  constructor(client: SupplierHubClient) {
    this.client = client;
  }

  /**
   * Initialize adapter with Supplier Hub configuration
   */
  initialize(config: SupplierHubConfig, supplierPriority: string[] = []): void {
    this.config = config;
    this.supplierPriority = supplierPriority;
    this.client.initialize(config);
    this.logger.log(
      `Supplier Hub adapter initialized with priority: ${supplierPriority.join(', ')}`,
    );
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.config !== null && this.client.isInitialized();
  }

  /**
   * Set supplier priority order
   */
  setSupplierPriority(priority: string[]): void {
    this.supplierPriority = priority;
    this.logger.log(`Supplier priority updated: ${priority.join(', ')}`);
  }

  /**
   * Check supplier balance
   * Note: Supplier Hub doesn't provide a single balance endpoint
   * This would need to check individual supplier balances
   */
  async checkBalance(): Promise<SupplierBalance> {
    // Supplier Hub doesn't have a unified balance endpoint
    // Return a placeholder or check individual suppliers
    this.logger.warn('Balance check not directly supported by Supplier Hub');
    return {
      balance: 0,
      currency: 'USD',
    };
  }

  /**
   * Get products list from Supplier Hub
   */
  async getProducts(merchantId?: string): Promise<SupplierProduct[]> {
    if (!this.isInitialized()) {
      throw new Error('Supplier Hub adapter not initialized');
    }

    try {
      const products = await this.client.getAvailableProducts();
      return products.map((p) => ({
        id: p.product_code,
        name: p.name,
        price: p.suggested_sell_price || p.cost_price,
        costPrice: p.cost_price,
        available: p.available,
        currency: p.currency,
        supplierProductCode: p.product_code,
        metadata: {
          category: p.category,
          supplier: p.supplier,
        },
      }));
    } catch (error) {
      this.logger.error(`Error fetching products: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get product details by ID
   */
  async getProductDetails(productId: string): Promise<SupplierProduct> {
    if (!this.isInitialized()) {
      throw new Error('Supplier Hub adapter not initialized');
    }

    try {
      const products = await this.client.getAvailableProducts();
      const product = products.find((p) => p.product_code === productId);

      if (!product) {
        throw new Error(`Product ${productId} not found`);
      }

      return {
        id: product.product_code,
        name: product.name,
        price: product.suggested_sell_price || product.cost_price,
        costPrice: product.cost_price,
        available: product.available,
        currency: product.currency,
        supplierProductCode: product.product_code,
        metadata: {
          category: product.category,
          supplier: product.supplier,
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching product ${productId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if product is available
   */
  async checkProductAvailability(productId: string): Promise<boolean> {
    try {
      const product = await this.getProductDetails(productId);
      return product.available;
    } catch (error) {
      this.logger.error(`Error checking availability for ${productId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Purchase product from Supplier Hub
   * This is the main method that uses Supplier Hub's sequential fallback
   */
  async purchaseProduct(
    request: SupplierPurchaseRequest,
    sellPrice?: number,
    currency: string = 'USD',
  ): Promise<SupplierPurchaseResponse> {
    if (!this.isInitialized()) {
      throw new Error('Supplier Hub adapter not initialized');
    }

    if (this.supplierPriority.length === 0) {
      throw new Error('No supplier priority configured');
    }

    // Generate unique order reference if not provided
    const orderRef = request.resellerRefNumber || `KAWN-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // Get sell price from parameter or try to fetch from product
    let finalSellPrice = sellPrice || 0;
    let finalCurrency = currency;

    if (!finalSellPrice) {
      try {
        const product = await this.getProductDetails(request.productId);
        finalSellPrice = product.price;
        finalCurrency = product.currency || 'USD';
      } catch (error) {
        this.logger.warn(
          `Could not fetch product details for ${request.productId}, sell price must be provided`,
        );
        throw new Error('Sell price is required for Supplier Hub purchase');
      }
    }

    // Build Supplier Hub order request
    const hubRequest: CreateOrderRequest = {
      order_ref: orderRef,
      product_code: request.productId,
      quantity: request.quantity || 1,
      sell_price: finalSellPrice,
      currency: finalCurrency,
      supplier_priority: this.supplierPriority.map((s) =>
        SupplierHubClient.mapSupplierToHubCode(s),
      ),
      metadata: {
        resellerRefNumber: request.resellerRefNumber,
        terminalId: request.terminalId,
        inquireReferenceNumber: request.inquireReferenceNumber,
        inputParameters: request.inputParameters,
      },
    };

    try {
      const response = await this.client.createOrder(hubRequest);

      // Handle different response scenarios
      if (response.status === 'success' && response.deliverables) {
        // Extract codes from deliverables
        const codes = response.deliverables.map((d) => d.value).join(', ');
        const firstCode = response.deliverables[0];

        return {
          transactionId: response.order_ref,
          resellerRefNumber: request.resellerRefNumber,
          costPrice: response.supplier_cost || 0,
          balance: 0, // Supplier Hub doesn't provide balance
          currency: finalCurrency,
          serial: firstCode?.value,
          pin: firstCode?.value,
          metadata: {
            supplier: response.supplier,
            profitMargin: response.profit_margin,
            deliverables: response.deliverables,
            allCodes: codes,
          },
        };
      } else if (response.code === 'PRICE_CONFLICT') {
        // Price conflict - codes stored internally, not delivered
        throw new Error(
          `Price conflict: Supplier cost (${response.supplier_cost}) exceeds sell price (${response.sell_price}). Codes stored in Supplier Hub internal stock.`,
        );
      } else if (response.code === 'SUPPLIER_NOT_AVAILABLE') {
        // All suppliers failed
        const errorDetails = response.attempts
          ?.map((a) => `${a.supplier}: ${a.error}`)
          .join('; ') || 'All suppliers failed';
        throw new Error(`All suppliers failed: ${errorDetails}`);
      } else {
        // Other failure
        throw new Error(response.message || 'Order failed via Supplier Hub');
      }
    } catch (error) {
      this.logger.error(`Error purchasing via Supplier Hub: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check transaction status
   */
  async checkTransactionStatus(
    resellerRefNumber: string,
  ): Promise<SupplierPurchaseResponse> {
    if (!this.isInitialized()) {
      throw new Error('Supplier Hub adapter not initialized');
    }

    try {
      const order = await this.client.getOrder(resellerRefNumber);

      if (order.status === 'success' && order.deliverables) {
        const firstCode = order.deliverables[0];
        return {
          transactionId: order.order_ref,
          resellerRefNumber: resellerRefNumber,
          costPrice: order.supplier_cost || 0,
          balance: 0,
          currency: 'USD',
          serial: firstCode?.value,
          pin: firstCode?.value,
          metadata: {
            supplier: order.supplier,
            deliverables: order.deliverables,
          },
        };
      } else {
        throw new Error(order.message || 'Order not found or failed');
      }
    } catch (error) {
      this.logger.error(
        `Error checking transaction status: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Test connection to Supplier Hub
   */
  async testConnection(): Promise<boolean> {
    if (!this.isInitialized()) {
      return false;
    }

    try {
      const health = await this.client.healthCheck();
      return health.status === 'ok' || health.status === 'healthy';
    } catch (error) {
      this.logger.error(`Connection test failed: ${error.message}`);
      return false;
    }
  }
}


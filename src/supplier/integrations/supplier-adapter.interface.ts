// Supplier Adapter Interface - allows different supplier types to be integrated
export interface SupplierProduct {
  id: string;
  name: string;
  nameAr?: string;
  price: number;
  costPrice?: number;
  available: boolean;
  currency?: string;
  supplierProductCode?: string;
  metadata?: any;
}

export interface SupplierBalance {
  balance: number;
  currency: string;
}

export interface SupplierPurchaseRequest {
  productId: string;
  quantity?: number;
  resellerRefNumber: string;
  terminalId?: string;
  // For bill products
  inquireReferenceNumber?: string;
  inputParameters?: Record<string, string>;
}

export interface SupplierPurchaseResponse {
  transactionId: string;
  resellerRefNumber: string;
  costPrice: number;
  balance: number;
  currency: string;
  serial?: string;
  pin?: string;
  username?: string;
  expirationDate?: string;
  metadata?: any;
}

export interface SupplierAdapter {
  /**
   * Check supplier balance
   */
  checkBalance(): Promise<SupplierBalance>;

  /**
   * Get products list from supplier
   */
  getProducts(merchantId?: string): Promise<SupplierProduct[]>;

  /**
   * Get product details by ID
   */
  getProductDetails(productId: string): Promise<SupplierProduct>;

  /**
   * Check if product is available
   */
  checkProductAvailability(productId: string): Promise<boolean>;

  /**
   * Purchase product from supplier
   */
  purchaseProduct(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResponse>;

  /**
   * Check transaction status
   */
  checkTransactionStatus(resellerRefNumber: string): Promise<SupplierPurchaseResponse>;

  /**
   * Test connection/authentication
   */
  testConnection(): Promise<boolean>;
}


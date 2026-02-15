// Bitaqaty Business API Integration Service
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';

export interface BitaqatyConfig {
  resellerUsername: string;
  secretKey: string;
  environment: 'staging' | 'production';
  merchantId?: string;
}

export interface BitaqatyProduct {
  productID: string;
  nameEn: string;
  nameAr?: string;
  faceValue?: number;
  costPriceBeforeVat?: number;
  costPriceAfterVat?: number;
  recommendedRetailPriceAfterVat?: number;
  currency?: string;
  available: boolean;
  merchantid?: number;
  merchantNameEn?: string;
  merchantNameAr?: string;
  categoryNameEn?: string;
  categoryNameAr?: string;
  image?: string;
  vatType?: string;
  vatPercentage?: number;
  inquiryRequired?: boolean;
  dynamicFormList?: any[];
  esimSpecifications?: any[];
}

export interface BitaqatyBalance {
  balance: number;
  currency: string;
}

export interface BitaqatyPurchaseResponse {
  bbTrxRefNumber: string;
  resellerRefNumber: string;
  costPriceAfterVat: number;
  balance: number;
  currency: string;
  productType: number; // 1: Credential, 2: Serial, 3: Service, 4: Priced Voucher
  serial?: string;
  pin?: string;
  username?: string;
  itemExpirationDate?: string;
  isQrCode?: boolean;
  productItemDetails?: any[];
}

export interface BitaqatyBillInquiry {
  inquireReferenceNumber: string;
  requestStatus: string;
  serviceHubStatusEnum: string;
  consumerNumber?: string;
  dueDate?: string;
  billStatus?: string;
  billAmount?: number;
  costPriceAfterVat?: number;
  recommendedRetailPriceAfterVat?: number;
  inquiryInfoText?: string;
}

@Injectable()
export class BitaqatyBusinessService {
  private readonly logger = new Logger(BitaqatyBusinessService.name);
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * SECURITY FIX: Generate HMAC-SHA256 for password authentication instead of MD5
   * MD5 is cryptographically broken and unsuitable for security-critical operations
   */
  private generatePassword(parts: string[], secretKey: string): string {
    const combined = parts.join('');
    return crypto.createHmac('sha256', secretKey).update(combined).digest('hex');
  }

  /**
   * Get API base URL based on environment
   */
  private getBaseUrl(environment: 'staging' | 'production'): string {
    return environment === 'production'
      ? 'https://apis.bitaqatybusiness.com'
      : 'https://bbapi.ocstaging.net';
  }

  /**
   * Check balance
   */
  async checkBalance(config: BitaqatyConfig): Promise<BitaqatyBalance> {
    try {
      const password = this.generatePassword([config.resellerUsername], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/check-balance`,
        {
          resellerUsername: config.resellerUsername,
          password,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to check balance'
        );
      }

      return {
        balance: response.data.balance || 0,
        currency: response.data.currency || 'SAR',
      };
    } catch (error: any) {
      this.logger.error('Error checking Bitaqaty balance:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to check balance'
      );
    }
  }

  /**
   * Get detailed products list
   */
  async getDetailedProductsList(
    config: BitaqatyConfig,
    merchantId?: string,
    responseParams?: string
  ): Promise<BitaqatyProduct[]> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        merchantId || '',
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const payload: any = {
        resellerUsername: config.resellerUsername,
        password,
      };

      if (merchantId) {
        payload.merchantId = merchantId;
      }

      if (responseParams) {
        payload.responseParams = responseParams;
      }

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/detailed-products-list`,
        payload
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to get products list'
        );
      }

      return response.data.products || [];
    } catch (error: any) {
      this.logger.error('Error getting Bitaqaty products:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to get products list'
      );
    }
  }

  /**
   * Get detailed bill products list
   */
  async getDetailedBillProductsList(
    config: BitaqatyConfig,
    merchantId?: string,
    responseParams?: string
  ): Promise<BitaqatyProduct[]> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        merchantId || '',
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const payload: any = {
        resellerUsername: config.resellerUsername,
        password,
      };

      if (merchantId) {
        payload.merchantId = merchantId;
      }

      if (responseParams) {
        payload.responseParams = responseParams;
      }

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/detailed-bill-products-list`,
        payload
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to get bill products list'
        );
      }

      return response.data.billProducts || [];
    } catch (error: any) {
      this.logger.error('Error getting Bitaqaty bill products:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to get bill products list'
      );
    }
  }

  /**
   * Get product detailed info
   */
  async getProductDetailedInfo(
    config: BitaqatyConfig,
    productId: string
  ): Promise<BitaqatyProduct> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        productId,
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/product-detailed-info`,
        {
          resellerUsername: config.resellerUsername,
          password,
          productID: productId,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to get product info'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error getting Bitaqaty product info:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to get product info'
      );
    }
  }

  /**
   * Bill inquiry
   */
  async billInquire(
    config: BitaqatyConfig,
    productId: string,
    inputParameters: Record<string, string>
  ): Promise<BitaqatyBillInquiry> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        productId], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/service-bill-inquire`,
        {
          resellerUsername: config.resellerUsername,
          password,
          productId,
          inputParameters,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to inquire bill'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error inquiring Bitaqaty bill:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to inquire bill'
      );
    }
  }

  /**
   * Top-up inquire (calculate top-up amount)
   */
  async topUpInquire(
    config: BitaqatyConfig,
    productId: string,
    amount: number
  ): Promise<any> {
    try {
      const password = this.generatePassword([config.resellerUsername,
        productId], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/calculate-topup-amount`,
        {
          resellerUsername: config.resellerUsername,
          password,
          productId,
          amount,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to calculate top-up amount'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error calculating top-up amount:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to calculate top-up amount'
      );
    }
  }

  /**
   * Pay a bill
   */
  async payBill(
    config: BitaqatyConfig,
    resellerRefNumber: string,
    options: {
      inquireReferenceNumber?: string; // For inquiry products
      productId?: string; // For top-up products
      inputParameters?: Record<string, string>; // For top-up products
      terminalID?: string;
    }
  ): Promise<BitaqatyPurchaseResponse> {
    try {
      const password = this.generatePassword([config.resellerUsername,
        resellerRefNumber], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const payload: any = {
        resellerUsername: config.resellerUsername,
        password,
        resellerRefNumber,
      };

      if (options.inquireReferenceNumber) {
        payload.inquireReferenceNumber = options.inquireReferenceNumber;
      }

      if (options.productId && options.inputParameters) {
        payload.productId = options.productId;
        payload.inputParameters = options.inputParameters;
      }

      if (options.terminalID) {
        payload.terminalID = options.terminalID;
      }

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/service-bill-pay`,
        payload
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to pay bill'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error paying Bitaqaty bill:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to pay bill'
      );
    }
  }

  /**
   * Purchase a product
   */
  async purchaseProduct(
    config: BitaqatyConfig,
    productId: string,
    resellerRefNumber: string,
    terminalId?: string
  ): Promise<BitaqatyPurchaseResponse> {
    try {
      const password = this.generatePassword([config.resellerUsername,
        productId,
        resellerRefNumber,
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const payload: any = {
        resellerUsername: config.resellerUsername,
        password,
        productID: productId,
        resellerRefNumber,
      };

      if (terminalId) {
        payload.terminalId = terminalId;
      }

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/purchase-product`,
        payload
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to purchase product'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error purchasing Bitaqaty product:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to purchase product'
      );
    }
  }

  /**
   * Check transaction status
   */
  async checkTransactionStatus(
    config: BitaqatyConfig,
    resellerRefNumber: string
  ): Promise<BitaqatyPurchaseResponse> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        resellerRefNumber], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/check-transaction-status`,
        {
          resellerUsername: config.resellerUsername,
          password,
          resellerRefNumber,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to check transaction status'
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error('Error checking Bitaqaty transaction status:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to check transaction status'
      );
    }
  }

  /**
   * Get merchant list
   */
  async getMerchantList(
    config: BitaqatyConfig,
    billMerchantsOnly?: boolean,
    esimMerchantsOnly?: boolean
  ): Promise<any[]> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const payload: any = {
        resellerUsername: config.resellerUsername,
        password,
      };

      if (billMerchantsOnly !== undefined) {
        payload.billMerchantsOnly = billMerchantsOnly;
      }

      if (esimMerchantsOnly !== undefined) {
        payload.esimMerchantsOnly = esimMerchantsOnly;
      }

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/get-merchant-list`,
        payload
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to get merchant list'
        );
      }

      return response.data.merchantList || [];
    } catch (error: any) {
      this.logger.error('Error getting Bitaqaty merchant list:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to get merchant list'
      );
    }
  }

  /**
   * Reconcile transactions
   */
  async reconcile(
    config: BitaqatyConfig,
    dateFrom: string,
    dateTo: string,
    isSuccessful: boolean
  ): Promise<any[]> {
    try {
      const password = this.generatePassword([
        config.resellerUsername,
        dateFrom,
        dateTo,
        String(isSuccessful),
      ], config.secretKey);
      const baseUrl = this.getBaseUrl(config.environment);

      const response = await this.axiosInstance.post(
        `${baseUrl}/integration/reconcile`,
        {
          resellerUsername: config.resellerUsername,
          password,
          dateFrom,
          dateTo,
          isSuccessful,
        }
      );

      if (!response.data.status) {
        throw new BadRequestException(
          response.data.errorMessage || 'Failed to reconcile transactions'
        );
      }

      return response.data.transactions || [];
    } catch (error: any) {
      this.logger.error('Error reconciling Bitaqaty transactions:', error);
      throw new BadRequestException(
        error.response?.data?.errorMessage || error.message || 'Failed to reconcile transactions'
      );
    }
  }
}


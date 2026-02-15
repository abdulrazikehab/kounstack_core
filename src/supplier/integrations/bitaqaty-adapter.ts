// Bitaqaty Business Adapter Implementation
import { Injectable, Logger } from '@nestjs/common';
import { BitaqatyBusinessService, BitaqatyConfig } from './bitaqaty-business.service';
import {
  SupplierAdapter,
  SupplierProduct,
  SupplierBalance,
  SupplierPurchaseRequest,
  SupplierPurchaseResponse,
} from './supplier-adapter.interface';

@Injectable()
export class BitaqatyAdapter implements SupplierAdapter {
  private readonly logger = new Logger(BitaqatyAdapter.name);
  private config: BitaqatyConfig;

  constructor(
    private bitaqatyService: BitaqatyBusinessService,
    config: BitaqatyConfig
  ) {
    this.config = config;
  }

  async checkBalance(): Promise<SupplierBalance> {
    const balance = await this.bitaqatyService.checkBalance(this.config);
    return {
      balance: balance.balance,
      currency: balance.currency,
    };
  }

  async getProducts(merchantId?: string): Promise<SupplierProduct[]> {
    const products = await this.bitaqatyService.getDetailedProductsList(
      this.config,
      merchantId
    );

    return products.map((p) => ({
      id: p.productID,
      name: p.nameEn,
      nameAr: p.nameAr,
      price: p.costPriceAfterVat || p.costPriceBeforeVat || 0,
      costPrice: p.costPriceBeforeVat || 0,
      available: p.available,
      currency: p.currency,
      supplierProductCode: p.productID,
      metadata: {
        faceValue: p.faceValue,
        vatType: p.vatType,
        vatPercentage: p.vatPercentage,
        merchantId: p.merchantid,
        merchantName: p.merchantNameEn,
        categoryName: p.categoryNameEn,
        image: p.image,
        inquiryRequired: p.inquiryRequired,
        dynamicFormList: p.dynamicFormList,
        esimSpecifications: p.esimSpecifications,
      },
    }));
  }

  async getProductDetails(productId: string): Promise<SupplierProduct> {
    const product = await this.bitaqatyService.getProductDetailedInfo(
      this.config,
      productId
    );

    return {
      id: product.productID,
      name: product.nameEn,
      nameAr: product.nameAr,
      price: product.costPriceAfterVat || product.costPriceBeforeVat || 0,
      costPrice: product.costPriceBeforeVat || 0,
      available: product.available,
      currency: product.currency,
      supplierProductCode: product.productID,
      metadata: {
        faceValue: product.faceValue,
        vatType: product.vatType,
        vatPercentage: product.vatPercentage,
        merchantId: product.merchantid,
        merchantName: product.merchantNameEn,
        categoryName: product.categoryNameEn,
        image: product.image,
        inquiryRequired: product.inquiryRequired,
        dynamicFormList: product.dynamicFormList,
        esimSpecifications: product.esimSpecifications,
      },
    };
  }

  async checkProductAvailability(productId: string): Promise<boolean> {
    try {
      const product = await this.getProductDetails(productId);
      return product.available;
    } catch (error) {
      this.logger.error(`Error checking availability for product ${productId}:`, error);
      return false;
    }
  }

  async purchaseProduct(
    request: SupplierPurchaseRequest
  ): Promise<SupplierPurchaseResponse> {
    let purchaseResponse;

    // Check if this is a bill product (requires inquiry first)
    const product = await this.getProductDetails(request.productId);
    const isBillProduct = product.metadata?.inquiryRequired === true;

    if (isBillProduct && request.inquireReferenceNumber) {
      // Bill payment
      purchaseResponse = await this.bitaqatyService.payBill(this.config, request.resellerRefNumber, {
        inquireReferenceNumber: request.inquireReferenceNumber,
        terminalID: request.terminalId,
      });
    } else if (!isBillProduct && request.inputParameters) {
      // Top-up product
      purchaseResponse = await this.bitaqatyService.payBill(this.config, request.resellerRefNumber, {
        productId: request.productId,
        inputParameters: request.inputParameters,
        terminalID: request.terminalId,
      });
    } else {
      // Regular product purchase
      purchaseResponse = await this.bitaqatyService.purchaseProduct(
        this.config,
        request.productId,
        request.resellerRefNumber,
        request.terminalId
      );
    }

    return {
      transactionId: purchaseResponse.bbTrxRefNumber,
      resellerRefNumber: purchaseResponse.resellerRefNumber,
      costPrice: purchaseResponse.costPriceAfterVat,
      balance: purchaseResponse.balance,
      currency: purchaseResponse.currency,
      serial: purchaseResponse.serial,
      pin: purchaseResponse.pin,
      username: purchaseResponse.username,
      expirationDate: purchaseResponse.itemExpirationDate,
      metadata: {
        productType: purchaseResponse.productType,
        isQrCode: purchaseResponse.isQrCode,
        productItemDetails: purchaseResponse.productItemDetails,
      },
    };
  }

  async checkTransactionStatus(
    resellerRefNumber: string
  ): Promise<SupplierPurchaseResponse> {
    const status = await this.bitaqatyService.checkTransactionStatus(
      this.config,
      resellerRefNumber
    );

    return {
      transactionId: status.bbTrxRefNumber || '',
      resellerRefNumber: status.resellerRefNumber || resellerRefNumber,
      costPrice: status.costPriceAfterVat || 0,
      balance: status.balance || 0,
      currency: status.currency || 'SAR',
      serial: status.serial,
      pin: status.pin,
      username: status.username,
      expirationDate: status.itemExpirationDate,
      metadata: {
        productType: status.productType,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.checkBalance();
      return true;
    } catch (error) {
      this.logger.error('Bitaqaty connection test failed:', error);
      return false;
    }
  }
}


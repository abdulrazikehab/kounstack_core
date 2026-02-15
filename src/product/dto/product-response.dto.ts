// apps/app-core/src/product/dto/product-response.dto.ts
export class ProductVariantResponseDto {
  id!: string;
  name!: string;
  sku?: string;
  price!: number;
  compareAtPrice?: number;
  inventoryQuantity!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ProductImageResponseDto {
  id!: string;
  url!: string;
  altText?: string;
  sortOrder!: number;
  createdAt!: Date;
}

export class ProductResponseDto {
  id!: string;
  tenantId!: string;
  name!: string;
  description?: string;
  sku?: string;
  price!: number;
  compareAtPrice?: number;
  costPerItem?: number;
  isAvailable!: boolean;
  isPublished?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  nameAr?: string;
  descriptionAr?: string;
  barcode?: string;
  featured?: boolean;
  weight?: number;
  dimensions?: string;
  coinsNumber?: number;
  notify?: boolean;
  min?: number;
  max?: number;
  webStatus?: boolean;
  mobileStatus?: boolean;
  enableSlider?: boolean;
  sliderStep?: number;
  sliderStepMode?: string;
  featuredPriceIncrease?: number;
  featuredPriceCurrency?: string;
  purpleCardsProductNameAr?: string;
  purpleCardsProductNameEn?: string;
  purpleCardsSlugAr?: string;
  purpleCardsSlugEn?: string;
  purpleCardsDescAr?: string;
  purpleCardsDescEn?: string;
  purpleCardsLongDescAr?: string;
  purpleCardsLongDescEn?: string;
  purpleCardsMetaTitleAr?: string;
  purpleCardsMetaTitleEn?: string;
  purpleCardsMetaKeywordAr?: string;
  purpleCardsMetaKeywordEn?: string;
  purpleCardsMetaDescriptionAr?: string;
  purpleCardsMetaDescriptionEn?: string;
  ish7enProductNameAr?: string;
  ish7enProductNameEn?: string;
  ish7enSlugAr?: string;
  ish7enSlugEn?: string;
  ish7enDescAr?: string;
  ish7enDescEn?: string;
  ish7enLongDescAr?: string;
  ish7enLongDescEn?: string;
  ish7enMetaTitleAr?: string;
  ish7enMetaTitleEn?: string;
  ish7enMetaKeywordAr?: string;
  ish7enMetaKeywordEn?: string;
  ish7enMetaDescriptionAr?: string;
  ish7enMetaDescriptionEn?: string;
  createdAt!: Date;
  updatedAt!: Date;
  priceExceed?: boolean;

  variants?: ProductVariantResponseDto[];
  images?: ProductImageResponseDto[];
  categories?: any[]; // We'll define CategoryResponseDto later
  productId?: string;
  productCode?: string;
  odooProductId?: string;
  brand?: {
    id: string;
    name: string;
    nameAr?: string;
    code?: string;
    priceExceed?: boolean;
  };
  suppliers?: Array<{
    id: string;
    supplierId: string;
    supplier: {
      id: string;
      name: string;
      nameAr?: string;
      discountRate: number;
    };
    discountRate: number;
    isPrimary: boolean;
    cost?: number;
    supplierProductCode?: string;
    lastPrice?: number;
    lastPriceCheck?: Date;
  }>;
  unit?: {
    id: string;
    name: string;
    nameAr?: string;
    code: string;
    symbol?: string;
    cost: number;
  };
}
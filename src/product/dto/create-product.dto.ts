// apps/app-core/src/product/dto/create-product.dto.ts
import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductVariantDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  compareAtPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  inventoryQuantity?: number;
}

export class ProductImageDto {
  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  altText?: string;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class CreateProductDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  descriptionAr?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  compareAtPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  costPerItem?: number;

  @IsString()
  @IsOptional()
  priceCurrency?: string;

  @IsString()
  @IsOptional()
  costCurrency?: string;

  @IsString()
  @IsOptional()
  displayCurrency?: string;

  @IsString()
  @IsOptional()
  featuredStartDate?: string;

  @IsString()
  @IsOptional()
  featuredEndDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  featuredPriceIncrease?: number;

  @IsString()
  @IsOptional()
  featuredPriceCurrency?: string;

  @IsNumber()
  @IsOptional()
  stockCount?: number;

  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsString()
  @IsOptional()
  dimensions?: string;

  @IsString()
  @IsOptional()
  seoTitle?: string;

  @IsString()
  @IsOptional()
  seoDescription?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  @IsOptional()
  variants?: ProductVariantDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  @IsOptional()
  images?: ProductImageDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categoryIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  productCode?: string;

  @IsString()
  @IsOptional()
  odooProductId?: string;

  @IsString()
  @IsOptional()
  brandId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  supplierIds?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSupplierDto)
  @IsOptional()
  suppliers?: ProductSupplierDto[];

  @IsString()
  @IsOptional()
  unitId?: string;

  @IsNumber()
  @IsOptional()
  coinsNumber?: number;

  @IsBoolean()
  @IsOptional()
  notify?: boolean;

  @IsNumber()
  @IsOptional()
  min?: number;

  @IsNumber()
  @IsOptional()
  max?: number;

  @IsBoolean()
  @IsOptional()
  enableSlider?: boolean;

  @IsNumber()
  @IsOptional()
  sliderStep?: number;

  @IsString()
  @IsOptional()
  sliderStepMode?: string;

  @IsBoolean()
  @IsOptional()
  priceExceed?: boolean;

  @IsBoolean()
  @IsOptional()
  webStatus?: boolean;

  @IsBoolean()
  @IsOptional()
  mobileStatus?: boolean;

  @IsString()
  @IsOptional()
  purpleCardsProductNameAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsProductNameEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsSlugAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsSlugEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsDescAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsDescEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsLongDescAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsLongDescEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaTitleAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaTitleEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaKeywordAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaKeywordEn?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaDescriptionAr?: string;

  @IsString()
  @IsOptional()
  purpleCardsMetaDescriptionEn?: string;

  @IsString()
  @IsOptional()
  ish7enProductNameAr?: string;

  @IsString()
  @IsOptional()
  ish7enProductNameEn?: string;

  @IsString()
  @IsOptional()
  ish7enSlugAr?: string;

  @IsString()
  @IsOptional()
  ish7enSlugEn?: string;

  @IsString()
  @IsOptional()
  ish7enDescAr?: string;

  @IsString()
  @IsOptional()
  ish7enDescEn?: string;

  @IsString()
  @IsOptional()
  ish7enLongDescAr?: string;

  @IsString()
  @IsOptional()
  ish7enLongDescEn?: string;

  @IsString()
  @IsOptional()
  ish7enMetaTitleAr?: string;

  @IsString()
  @IsOptional()
  ish7enMetaTitleEn?: string;

  @IsString()
  @IsOptional()
  ish7enMetaKeywordAr?: string;

  @IsString()
  @IsOptional()
  ish7enMetaKeywordEn?: string;

  @IsString()
  @IsOptional()
  ish7enMetaDescriptionAr?: string;

  @IsString()
  @IsOptional()
  ish7enMetaDescriptionEn?: string;
}

export class ProductSupplierDto {
  @IsString()
  supplierId!: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountRate?: number;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number; // Supplier price (legacy/fallback)

  @IsNumber()
  @Min(0)
  @IsOptional()
  cost?: number; // Supplier cost (new preferred field)

  @IsString()
  @IsOptional()
  supplierProductCode?: string;
}
import { IsString, IsOptional, IsNotEmpty, Matches, IsBoolean, IsNumber, Min } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
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
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  slug?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;

  // Quantity slider fields for supplier API integration
  @IsNumber()
  @IsOptional()
  @Min(1)
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  maxQuantity?: number;

  @IsBoolean()
  @IsOptional()
  enableSlider?: boolean;

  @IsBoolean()
  @IsOptional()
  applySliderToAllProducts?: boolean;

  @IsBoolean()
  @IsOptional()
  priceExceed?: boolean;
}

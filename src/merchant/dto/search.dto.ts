import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  IsEnum,
  ValidateNested,
  Min,
  Max,
  MinLength,
  IsDateString,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EntityType {
  TASKS = 'tasks',
  PRODUCTS = 'products',
  ORDERS = 'orders',
  CUSTOMERS = 'customers',
}

export enum SortBy {
  RELEVANCE = 'relevance',
  DATE = 'date',
  PRICE = 'price',
  NAME = 'name',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class TaskFiltersDto {
  @IsOptional()
  @IsArray()
  @IsEnum(['pending', 'in_progress', 'completed', 'cancelled'], { each: true })
  status?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(['low', 'medium', 'high'], { each: true })
  priority?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignedTo?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  category?: string[];
}

export class ProductFiltersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  category?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(['active', 'inactive'], { each: true })
  status?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(['infinite', 'preloaded_codes', 'real_time_api'], { each: true })
  stockType?: string[];

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;
}

export class OrderFiltersDto {
  @IsOptional()
  @IsArray()
  @IsEnum(['pending', 'processing', 'completed', 'failed', 'cancelled'], { each: true })
  status?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(['pending_payment', 'under_review', 'paid', 'failed'], { each: true })
  paymentStatus?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountMax?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerId?: string[];
}

export class CustomerFiltersDto {
  @IsOptional()
  @IsArray()
  @IsEnum(['active', 'blocked', 'pending'], { each: true })
  status?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class SearchFiltersDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskFiltersDto)
  tasks?: TaskFiltersDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductFiltersDto)
  products?: ProductFiltersDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderFiltersDto)
  orders?: OrderFiltersDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerFiltersDto)
  customers?: CustomerFiltersDto;
}

export class PaginationDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SortingDto {
  @IsOptional()
  @IsEnum(SortBy)
  by?: SortBy = SortBy.RELEVANCE;

  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}

export class SearchRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  query?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(EntityType, { each: true })
  entities?: EntityType[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFiltersDto)
  filters?: SearchFiltersDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaginationDto)
  pagination?: PaginationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SortingDto)
  sorting?: SortingDto;
}

export class SaveSearchHistoryDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(EntityType, { each: true })
  entities?: EntityType[];

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  resultCount?: number;
}

export class DeleteSearchHistoryDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  clearAll?: boolean;
}

export class SearchSuggestionsQueryDto {
  @IsString()
  @MinLength(2)
  q!: string;

  @IsOptional()
  @IsArray()
  @IsEnum(EntityType, { each: true })
  entities?: EntityType[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}


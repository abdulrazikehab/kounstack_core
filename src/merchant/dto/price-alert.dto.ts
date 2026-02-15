import { IsString, IsEnum, IsOptional } from 'class-validator';

export class CreatePriceAlertDto {
  @IsString()
  productId!: string;

  @IsEnum(['any_change', 'drop_only', 'rise_only'])
  alertType!: 'any_change' | 'drop_only' | 'rise_only';
}

export class PriceAlertResponse {
  id!: string;
  productId!: string;
  productName!: string;
  productNameAr?: string;
  productImage?: string;
  currentPrice!: number;
  alertType!: string;
  isActive!: boolean;
  lastNotifiedAt?: Date;
  lastNotifiedPrice?: number;
  createdAt!: Date;
}

export class PriceAlertListQuery {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsEnum(['any_change', 'drop_only', 'rise_only'])
  alertType?: 'any_change' | 'drop_only' | 'rise_only';
}

import { IsString, IsArray, IsOptional } from 'class-validator';

export class CreateMarketplaceDto {
  @IsString()
  name!: string;

  @IsString()
  nameAr!: string;

  @IsString()
  category!: string;

  @IsArray()
  products!: string[];

  @IsString()
  @IsOptional()
  logo?: string;

  @IsString()
  template!: string;

  @IsString()
  reportFrequency!: string;

  @IsArray()
  paymentGateways!: string[];

  @IsOptional()
  templateContent?: any;
}

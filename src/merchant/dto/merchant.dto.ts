import { IsString, IsOptional, IsEmail, IsNumber } from 'class-validator';

export class UpdateMerchantProfileDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessNameAr?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsNumber()
  lowBalanceThreshold?: number;
}

export class MerchantSettingsDto {
  @IsOptional()
  @IsString()
  locale?: string; // 'ar' | 'en'

  @IsOptional()
  @IsString()
  theme?: string; // 'system' | 'light' | 'dark'

  @IsOptional()
  notificationPreferences?: {
    orderUpdates?: boolean;
    priceAlerts?: boolean;
    promotions?: boolean;
    lowBalance?: boolean;
  };
}

export class MerchantProfileResponse {
  id!: string;
  businessName!: string;
  businessNameAr?: string;
  phone?: string;
  email?: string;
  countryCode!: string;
  defaultCurrency!: string;
  timezone!: string;
  status!: string;
  settings?: any;
  lowBalanceThreshold!: number;
  createdAt!: Date;
}

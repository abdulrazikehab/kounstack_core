import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class HyperPayConfigDto {
  @IsOptional()
  entityId?: string;

  @IsOptional()
  accessToken?: string;

  @IsOptional()
  testMode?: boolean;
}

export class UpdatePaymentSettingsDto {
  @IsOptional()
  @IsObject()
  hyperpay?: HyperPayConfigDto;

  @IsOptional()
  @IsObject()
  enabledMethods?: Record<string, boolean>;
}

export class TestHyperPayDto {
  entityId: string;
  accessToken: string;
  testMode?: boolean;
}

export class RefundPaymentDto {
  @IsOptional()
  amount?: number;
}


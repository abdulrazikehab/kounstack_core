import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, Min, IsEnum } from 'class-validator';

export class AddBankAccountDto {
  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsString()
  @IsOptional()
  bankCode?: string;

  @IsString()
  @IsNotEmpty()
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsString()
  @IsOptional()
  iban?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export enum PaymentMethod {
  BANK_TRANSFER = 'BANK_TRANSFER',
  VISA = 'VISA',
  MASTERCARD = 'MASTERCARD',
  MADA = 'MADA',
  APPLE_PAY = 'APPLE_PAY',
  STC_PAY = 'STC_PAY',
}

export class CreateTopUpRequestDto {
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsString()
  @IsOptional()
  bankId?: string;

  @IsString()
  @IsOptional()
  senderAccountId?: string;

  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional()
  transferReference?: string;

  @IsString()
  @IsOptional()
  receiptImage?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

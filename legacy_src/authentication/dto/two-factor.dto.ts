import { IsString, Length } from 'class-validator';

export class TwoFactorVerifyDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class TwoFactorSetupResponseDto {
  @IsString()
  secret!: string;

  @IsString()
  qrCode!: string;
}

import { IsString, IsOptional, IsEmail, MinLength, IsObject } from 'class-validator';

export class MerchantLoginDto {
  @IsString()
  identifier!: string; // email/phone/username

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsObject()
  device?: {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
  };
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class MerchantRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  businessName!: string;

  @IsOptional()
  @IsString()
  businessNameAr?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}


// apps/app-auth/src/auth/dto/signup.dto.ts
import { IsEmail, IsString, MinLength, Matches, IsNotEmpty, IsOptional } from 'class-validator';

export class SignUpDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  })
  password!: string;

  @IsString({ message: 'Name must be a string' })
  @IsOptional()
  name?: string;

  @IsString({ message: 'Store name must be a string' })
  @IsOptional()
  storeName?: string;

  @IsString({ message: 'Subdomain must be a string' })
  @IsOptional()
  @MinLength(3, { message: 'Subdomain must be at least 3 characters long' })
  @Matches(/^[a-z0-9-]+$/, { message: 'Subdomain can only contain lowercase letters, numbers, and hyphens' })
  subdomain?: string;



  @IsString({ message: 'National ID must be a string' })
  @IsNotEmpty({ message: 'National ID or Passport ID is required' })
  nationalId!: string;

  @IsOptional()
  fingerprint?: any;
}

export class SignUpResponseDto {
  id!: string;
  email!: string;
  recoveryId!: string; // Secret recovery ID for account recovery
  accessToken!: string;
  refreshToken!: string;
}
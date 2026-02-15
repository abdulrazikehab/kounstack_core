import { IsString, IsNotEmpty, IsOptional, Matches, MinLength, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class SetupMarketDto {
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : value;
    }
    return value;
  })
  @IsString({ message: 'Market name must be a string' })
  @IsNotEmpty({ message: 'Market name is required' })
  @MinLength(1, { message: 'Market name cannot be empty' })
  @MaxLength(255, { message: 'Market name is too long' })
  name!: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    return value;
  })
  @IsString({ message: 'Subdomain must be a string' })
  @IsNotEmpty({ message: 'Subdomain is required' })
  @MinLength(3, { message: 'Subdomain must be at least 3 characters long' })
  @MaxLength(63, { message: 'Subdomain is too long' })
  @Matches(/^[a-z0-9-]+$/, { 
    message: 'Subdomain must contain only lowercase letters, numbers, and hyphens' 
  })
  subdomain!: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return value;
  })
  @IsOptional()
  @ValidateIf((o) => o.description !== undefined && o.description !== null && o.description !== '')
  @IsString({ message: 'Description must be a string' })
  @MaxLength(1000, { message: 'Description is too long' })
  description?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return value;
  })
  @IsOptional()
  @ValidateIf((o) => o.customDomain !== undefined && o.customDomain !== null && o.customDomain !== '')
  @IsString({ message: 'Custom domain must be a string' })
  @MaxLength(255, { message: 'Custom domain is too long' })
  customDomain?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return value;
  })
  @IsOptional()
  @ValidateIf((o) => o.template !== undefined && o.template !== null && o.template !== '')
  @IsString({ message: 'Template must be a string' })
  template?: string;
}


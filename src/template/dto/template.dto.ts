// DTOs for Template operations
import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name!: string;
  
  @IsString()
  category!: string;
  
  @IsOptional()
  @IsString()
  description?: string;
  
  @IsOptional()
  @IsString()
  thumbnail?: string;
  
  @IsObject()
  content!: any; // JSON structure of sections
  
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class TemplateResponseDto {
  id!: string;
  name!: string;
  category!: string;
  description?: string;
  thumbnail?: string;
  content!: any;
  isDefault!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ApplyTemplateDto {
  @IsString()
  templateId!: string;
  
  @IsOptional()
  @IsString()
  pageTitle?: string;
  
  @IsOptional()
  @IsString()
  pageSlug?: string;
}

export class TemplateFilterDto {
  @IsOptional()
  @IsString()
  category?: string;
  
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
  
  @IsOptional()
  @IsString()
  search?: string;
}

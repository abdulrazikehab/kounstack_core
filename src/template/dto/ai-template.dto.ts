import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class GenerateTemplateDto {
  @IsString()
  @IsNotEmpty()
  vision!: string; // User's description of what they want

  @IsEnum(['landing', 'about', 'contact', 'product', 'service', 'portfolio', 'blog', 'custom'])
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  businessType?: string; // e.g., "restaurant", "e-commerce", "portfolio"

  @IsString()
  @IsOptional()
  colorScheme?: string; // e.g., "modern blue", "warm earth tones"

  @IsString()
  @IsOptional()
  style?: string; // e.g., "minimalist", "bold", "elegant"
}

export class SaveGeneratedTemplateDto {
  @IsString()
  @IsNotEmpty()
  pageId!: string;

  @IsString()
  @IsNotEmpty()
  generatedContent!: string; // JSON stringified content

  @IsString()
  @IsOptional()
  title?: string;
}

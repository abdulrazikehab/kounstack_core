import { IsString, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name!: string; // e.g., "Koun Website", "Edara Mobile App", "Asus App"
}


import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';

export class UpdateApiKeyDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}


import { IsString, IsNotEmpty, IsOptional, IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmergencyItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  reason: string; // 'needed' | 'cost_gt_price' | 'manual'

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkEmergencyItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEmergencyItemDto)
  items: CreateEmergencyItemDto[];
}

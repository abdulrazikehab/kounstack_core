import { IsString, IsNotEmpty, IsEnum, IsBoolean, IsUUID } from 'class-validator';
import { InventoryType, EntityType } from '@prisma/client';

export class UpdateVisibilityDto {
  @IsEnum(InventoryType)
  @IsNotEmpty()
  inventoryType: InventoryType;

  @IsEnum(EntityType)
  @IsNotEmpty()
  entityType: EntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;

  @IsBoolean()
  @IsNotEmpty()
  isActive: boolean;
}

export class BulkUpdateVisibilityDto {
  @IsEnum(InventoryType)
  @IsNotEmpty()
  inventoryType: InventoryType;

  changes: {
    entityType: EntityType;
    entityId: string;
    isActive: boolean;
  }[];
}

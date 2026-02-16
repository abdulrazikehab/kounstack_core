import { IsString, IsNotEmpty, IsIn, IsBoolean } from 'class-validator';

// Define enums locally since they are not available in the current Prisma schema.
export enum InventoryType {
  CARD = 'CARD',
  PRODUCT = 'PRODUCT',
}

export enum EntityType {
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  BRAND = 'BRAND',
}

export class UpdateVisibilityDto {
  @IsIn(Object.values(InventoryType))
  @IsNotEmpty()
  inventoryType!: InventoryType;

  @IsIn(Object.values(EntityType))
  @IsNotEmpty()
  entityType!: EntityType;

  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsBoolean()
  @IsNotEmpty()
  isActive!: boolean;
}

export class BulkUpdateVisibilityDto {
  @IsIn(Object.values(InventoryType))
  @IsNotEmpty()
  inventoryType!: InventoryType;

  changes!: {
    entityType: EntityType;
    entityId: string;
    isActive: boolean;
  }[];
}

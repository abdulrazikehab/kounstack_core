import { IsString, IsNumber, IsOptional, Min, IsObject } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  qty!: number; // 0 to remove

  @IsOptional()
  @IsObject()
  metadata?: {
    playerId?: string;
    playerGameAccountId?: string;
    accountIdentifier?: string;
  };
}

export class UpdateCartItemDto {
  @IsNumber()
  @Min(0)
  qty!: number;
}

export class CartResponse {
  cartId!: string;
  currency!: string;
  items!: CartItemResponse[];
  totals!: CartTotals;
}

export class CartItemResponse {
  id!: string;
  productId!: string;
  productName!: string;
  productNameAr?: string;
  productImage?: string;
  qty!: number;
  effectiveUnitPrice!: number;
  lineTotal!: number;
  minQty!: number;
  maxQty!: number;
  availableStock!: number;
  metadata?: any;
}

export class CartTotals {
  subtotal!: number;
  discountTotal!: number;
  feesTotal!: number;
  taxTotal!: number;
  total!: number;
}


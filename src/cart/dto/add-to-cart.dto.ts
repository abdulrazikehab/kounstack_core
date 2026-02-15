import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class AddToCartDto {
  @IsString()
  productId!: string;

  @Transform(({ value }) => {
    // Handle string numbers
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? value : parsed;
    }
    return Number(value);
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsString()
  @IsOptional()
  productVariantId?: string;
}


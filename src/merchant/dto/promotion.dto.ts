import { IsString, IsOptional, IsEnum } from 'class-validator';

export class PromotionListQuery {
  @IsOptional()
  @IsEnum(['active', 'upcoming', 'expired'])
  status?: 'active' | 'upcoming' | 'expired';
}

export class PromotionResponse {
  id!: string;
  titleEn!: string;
  titleAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  type!: string;
  status!: string;
  startAt!: Date;
  endAt!: Date;
  imageUrl?: string;
  conditions!: PromotionConditions;
  benefit!: PromotionBenefit;
}

export class PromotionConditions {
  minOrders?: number;
  minVolume?: number;
  productIds?: string[];
  categoryIds?: string[];
}

export class PromotionBenefit {
  type!: 'discount_percent' | 'discount_fixed' | 'cashback_percent' | 'cashback_fixed';
  value!: number;
  maxDiscount?: number;
}

export class PromotionProgressResponse {
  promotionId!: string;
  progress!: {
    ordersCount?: number;
    volume?: number;
    currentValue?: number;
    targetValue?: number;
    percentage?: number;
  };
  isCompleted!: boolean;
  completedAt?: Date;
  estimatedReward?: number;
  rewardClaimed!: boolean;
}

export class PromotionDetailResponse extends PromotionResponse {
  progress?: PromotionProgressResponse;
}

import { IsOptional, IsBoolean, IsString } from 'class-validator';

export class NotificationListQuery {
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class NotificationResponse {
  id!: string;
  type!: string;
  titleEn!: string;
  titleAr?: string;
  bodyEn!: string;
  bodyAr?: string;
  data?: {
    orderId?: string;
    productId?: string;
    promotionId?: string;
    [key: string]: any;
  };
  readAt?: Date;
  createdAt!: Date;
}

export class UnreadCountResponse {
  count!: number;
}

import { IsString, IsOptional, IsArray, ValidateNested, IsEnum, IsNumber, IsBoolean, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QuickRechargeItem {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsString()
  playerGameAccountId?: string;

  @IsOptional()
  @IsString()
  accountIdentifier?: string;
}

export class CreateOrderFromCartDto {
  @IsEnum(['cart'])
  source!: 'cart';

  @IsString()
  cartId!: string;

  @IsOptional()
  @IsString()
  playerId?: string;

  @IsEnum(['wallet', 'bank_transfer'])
  paymentMethod!: 'wallet' | 'bank_transfer';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateQuickRechargeOrderDto {
  @IsEnum(['quick_recharge'])
  source!: 'quick_recharge';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickRechargeItem)
  items!: QuickRechargeItem[];

  @IsOptional()
  @IsString()
  playerId?: string;

  @IsEnum(['wallet', 'bank_transfer'])
  paymentMethod!: 'wallet' | 'bank_transfer';

  @IsOptional()
  @IsString()
  notes?: string;
}

export type CreateOrderDto = CreateOrderFromCartDto | CreateQuickRechargeOrderDto;

export class ReorderDto {
  @IsEnum(['wallet', 'bank_transfer'])
  paymentMethod!: 'wallet' | 'bank_transfer';

  @IsOptional()
  @IsString()
  playerId?: string;

  @IsOptional()
  @IsBoolean()
  useLatestPrices?: boolean; // default true
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SubmitBankTransferProofDto {
  @IsString()
  paymentIntentId!: string;

  @IsString()
  proofAttachmentUrl!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class OrderListQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsString()
  from?: string; // ISO date

  @IsOptional()
  @IsString()
  to?: string; // ISO date

  @IsOptional()
  @IsString()
  playerId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class OrderSummaryResponse {
  id!: string;
  orderNumber!: string;
  status!: string;
  paymentStatus!: string;
  paymentMethod!: string;
  source!: string;
  total!: number;
  currency!: string;
  itemsCount!: number;
  playerName?: string;
  createdAt!: Date;
  completedAt?: Date;
}

export class OrderDetailResponse extends OrderSummaryResponse {
  subtotal!: number;
  discountTotal!: number;
  feesTotal!: number;
  taxTotal!: number;
  profitTotal!: number;
  items!: OrderItemResponse[];
  events!: OrderEventResponse[];
  paymentIntent?: PaymentIntentResponse;
  player?: PlayerSnapshotResponse;
  invoice?: InvoiceSnapshotResponse;
}

export class OrderItemResponse {
  id!: string;
  productId!: string;
  productName!: string;
  productNameAr?: string;
  quantity!: number;
  unitPrice!: number;
  lineTotal!: number;
  deliveries?: DeliveryResponse[];
}

export class DeliveryResponse {
  cardCode!: string;
  cardPin?: string;
  deliveredAt!: Date;
  viewedAt?: Date;
}

export class OrderEventResponse {
  id!: string;
  type!: string;
  fromStatus?: string;
  toStatus?: string;
  message?: string;
  actorType!: string;
  createdAt!: Date;
}

export class PaymentIntentResponse {
  id!: string;
  method!: string;
  status!: string;
  amount!: number;
  currency!: string;
  bankDetails?: BankDetailsResponse;
  proofAttachmentUrl?: string;
  reviewNote?: string;
  expiresAt?: Date;
}

export class BankDetailsResponse {
  bankName!: string;
  bankNameAr?: string;
  accountName!: string;
  accountNumber!: string;
  iban!: string;
}

export class PlayerSnapshotResponse {
  id!: string;
  name!: string;
  phone?: string;
}

export class InvoiceSnapshotResponse {
  id!: string;
  invoiceNumber!: string;
  issuedAt!: Date;
}

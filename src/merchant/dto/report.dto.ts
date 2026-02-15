import { IsOptional, IsString, IsEnum } from 'class-validator';

export class ReportDateRangeQuery {
  @IsOptional()
  @IsEnum(['today', 'week', 'month', 'total'])
  range?: 'today' | 'week' | 'month' | 'total';

  @IsOptional()
  @IsString()
  from?: string; // ISO date

  @IsOptional()
  @IsString()
  to?: string; // ISO date
}

export class DashboardHomeResponse {
  walletBalance!: number;
  currency!: string;
  todayOrdersCount!: number;
  todayProfit!: number;
  pendingOrdersCount!: number;
  topSellingProducts!: TopProductResponse[];
  recentOrders!: RecentOrderResponse[];
  activePromotions!: ActivePromotionResponse[];
  unreadNotificationsCount!: number;
}

export class TopProductResponse {
  productId!: string;
  name!: string;
  nameAr?: string;
  image?: string;
  qty!: number;
  revenue!: number;
  profit!: number;
}

export class RecentOrderResponse {
  id!: string;
  orderNumber!: string;
  status!: string;
  total!: number;
  createdAt!: Date;
}

export class ActivePromotionResponse {
  id!: string;
  title!: string;
  titleAr?: string;
  progressPercentage!: number;
  endsAt!: Date;
}

export class ProfitReportResponse {
  profitTotal!: number;
  revenueTotal!: number;
  ordersCount!: number;
  currency!: string;
  breakdown?: {
    date: string;
    profit: number;
    revenue: number;
    ordersCount: number;
  }[];
}

export class TopProfitableProductsResponse {
  products!: {
    productId: string;
    name: string;
    nameAr?: string;
    image?: string;
    profit: number;
    qty: number;
    revenue: number;
  }[];
}

export class PriceChangesReportQuery extends ReportDateRangeQuery {
  @IsOptional()
  @IsString()
  productId?: string;
}

export class PriceChangesReportResponse {
  changes!: {
    productId: string;
    productName: string;
    oldPrice: number;
    newPrice: number;
    changePercent: number;
    changedAt: Date;
    reason?: string;
  }[];
}

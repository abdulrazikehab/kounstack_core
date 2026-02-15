import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SearchRequestDto,
  SaveSearchHistoryDto,
  DeleteSearchHistoryDto,
  EntityType,
  SortBy,
  SortOrder,
} from '../dto/search.dto';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

interface SearchResultItem {
  id: string;
  relevanceScore?: number;
  matchedFields?: string[];
  [key: string]: any;
}

interface EntitySearchResult {
  count: number;
  items: SearchResultItem[];
}

interface SearchResults {
  products?: EntitySearchResult;
  orders?: EntitySearchResult;
  tasks?: EntitySearchResult;
  customers?: EntitySearchResult;
}

@Injectable()
export class MerchantSearchService {
  private readonly logger = new Logger(MerchantSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main search method - searches across multiple entities
   */
  async search(
    tenantId: string,
    userId: string,
    searchRequest: SearchRequestDto,
  ): Promise<any> {
    try {
      const {
        query,
        entities = [EntityType.PRODUCTS, EntityType.ORDERS, EntityType.CUSTOMERS],
        filters = {},
        pagination = { page: 1, limit: 20 },
        sorting = { by: SortBy.RELEVANCE, order: SortOrder.DESC },
      } = searchRequest;

      const page = pagination.page || 1;
      const limit = Math.min(pagination.limit || 20, 100);
      const skip = (page - 1) * limit;

      const results: SearchResults = {};
      let totalResults = 0;

      // Search each entity type
      if (entities.includes(EntityType.PRODUCTS)) {
        const productResults = await this.searchProducts(
          tenantId,
          query,
          filters.products,
          skip,
          limit,
          sorting,
        );
        results.products = productResults;
        totalResults += productResults.count;
      }

      if (entities.includes(EntityType.ORDERS)) {
        const orderResults = await this.searchOrders(
          tenantId,
          query,
          filters.orders,
          skip,
          limit,
          sorting,
        );
        results.orders = orderResults;
        totalResults += orderResults.count;
      }

      if (entities.includes(EntityType.CUSTOMERS)) {
        const customerResults = await this.searchCustomers(
          tenantId,
          query,
          filters.customers,
          skip,
          limit,
          sorting,
        );
        results.customers = customerResults;
        totalResults += customerResults.count;
      }

      // Tasks are not implemented in the schema, so we'll return empty results
      if (entities.includes(EntityType.TASKS)) {
        results.tasks = { count: 0, items: [] };
      }

      // Calculate aggregations
      const aggregations = await this.calculateAggregations(tenantId, filters, entities);

      const totalPages = Math.ceil(totalResults / limit);

      return {
        success: true,
        query: query || '',
        totalResults,
        page,
        limit,
        totalPages,
        results,
        aggregations,
      };
    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to perform search');
    }
  }

  /**
   * Search products with full-text search and filters
   */
  private async searchProducts(
    tenantId: string,
    query: string | undefined,
    filters: any,
    skip: number,
    limit: number,
    sorting: any,
  ): Promise<EntitySearchResult> {
    const where: Prisma.ProductWhereInput = {
      tenantId,
    };

    // Text search
    if (query && query.trim()) {
      const searchQuery = query.trim();
      where.OR = [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { nameAr: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } },
        { descriptionAr: { contains: searchQuery, mode: 'insensitive' } },
        { sku: { contains: searchQuery, mode: 'insensitive' } },
        { productCode: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    // Filters
    if (filters) {
      if (filters.category && filters.category.length > 0) {
        where.categories = {
          some: {
            categoryId: { in: filters.category },
          },
        };
      }

      if (filters.priceMin !== undefined) {
        where.price = { ...where.price, gte: new Decimal(filters.priceMin) };
      }

      if (filters.priceMax !== undefined) {
        where.price = { ...where.price, lte: new Decimal(filters.priceMax) };
      }

      if (filters.status && filters.status.length > 0) {
        const isActive = filters.status.includes('active');
        where.isAvailable = isActive;
        where.isPublished = isActive;
      }

      if (filters.featured !== undefined) {
        where.featured = filters.featured;
      }

      if (filters.inStock !== undefined) {
        // Check if any variant has stock or if product has variants with stock
        where.variants = filters.inStock
          ? {
              some: {
                inventoryQuantity: { gt: 0 },
              },
            }
          : {
              none: {
                inventoryQuantity: { gt: 0 },
              },
            };
      }
    }

    // Build orderBy
    let orderBy: Prisma.ProductOrderByInput = {};
    if (sorting.by === SortBy.RELEVANCE && query) {
      // For relevance, we'll sort by name match first, then date
      orderBy = { name: 'asc' };
    } else if (sorting.by === SortBy.DATE) {
      orderBy = { createdAt: sorting.order || 'desc' };
    } else if (sorting.by === SortBy.PRICE) {
      orderBy = { price: sorting.order || 'asc' };
    } else if (sorting.by === SortBy.NAME) {
      orderBy = { name: sorting.order || 'asc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          categories: {
            include: {
              category: true,
            },
          },
          brand: true,
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Calculate relevance scores and matched fields
    const items = products.map((product) => {
      const item: SearchResultItem = {
        id: product.id,
        name: product.name,
        nameAr: product.nameAr,
        description: product.description,
        descriptionAr: product.descriptionAr,
        price: Number(product.price),
        sku: product.sku,
        productCode: product.productCode,
        status: product.isAvailable && product.isPublished ? 'active' : 'inactive',
        featured: product.featured,
        category: product.categories[0]?.category
          ? {
              id: product.categories[0].category.id,
              name: product.categories[0].category.name,
            }
          : null,
        createdAt: product.createdAt,
      };

      if (query) {
        const { score, matchedFields } = this.calculateRelevanceScore(product, query);
        item.relevanceScore = score;
        item.matchedFields = matchedFields;
      }

      return item;
    });

    return {
      count: total,
      items,
    };
  }

  /**
   * Search orders with filters
   */
  private async searchOrders(
    tenantId: string,
    query: string | undefined,
    filters: any,
    skip: number,
    limit: number,
    sorting: any,
  ): Promise<EntitySearchResult> {
    const where: Prisma.OrderWhereInput = {
      tenantId,
    };

    // Text search
    if (query && query.trim()) {
      const searchQuery = query.trim();
      where.OR = [
        { orderNumber: { contains: searchQuery, mode: 'insensitive' } },
        { customerEmail: { contains: searchQuery, mode: 'insensitive' } },
        { customerName: { contains: searchQuery, mode: 'insensitive' } },
        { customerPhone: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    // Filters
    if (filters) {
      if (filters.status && filters.status.length > 0) {
        // Map API status values to Prisma enum values
        const statusMap: Record<string, string> = {
          pending: 'PENDING',
          processing: 'PROCESSING',
          completed: 'DELIVERED', // API uses 'completed', Prisma uses 'DELIVERED'
          failed: 'CANCELLED',
          cancelled: 'CANCELLED',
          confirmed: 'CONFIRMED',
          shipped: 'SHIPPED',
          delivered: 'DELIVERED',
          refunded: 'REFUNDED',
        };
        where.status = {
          in: filters.status.map((s: string) => statusMap[s.toLowerCase()] || s.toUpperCase()),
        };
      }

      if (filters.paymentStatus && filters.paymentStatus.length > 0) {
        // Map API payment status values to Prisma enum values
        const paymentStatusMap: Record<string, string> = {
          pending_payment: 'PENDING',
          pending: 'PENDING',
          under_review: 'PROCESSING',
          processing: 'PROCESSING',
          paid: 'SUCCEEDED',
          succeeded: 'SUCCEEDED',
          failed: 'FAILED',
          refunded: 'REFUNDED',
          cancelled: 'CANCELLED',
        };
        where.paymentStatus = {
          in: filters.paymentStatus.map((s: string) =>
            paymentStatusMap[s.toLowerCase()] || s.toUpperCase(),
          ),
        };
      }

      if (filters.dateFrom) {
        where.createdAt = { ...where.createdAt, gte: new Date(filters.dateFrom) };
      }

      if (filters.dateTo) {
        where.createdAt = { ...where.createdAt, lte: new Date(filters.dateTo) };
      }

      if (filters.amountMin !== undefined) {
        where.totalAmount = { ...where.totalAmount, gte: new Decimal(filters.amountMin) };
      }

      if (filters.amountMax !== undefined) {
        where.totalAmount = { ...where.totalAmount, lte: new Decimal(filters.amountMax) };
      }

      if (filters.customerId && filters.customerId.length > 0) {
        // Note: Orders don't have userId field in schema, so we'll search by email
        where.customerEmail = { in: filters.customerId };
      }
    }

    // Build orderBy
    let orderBy: Prisma.OrderOrderByInput = {};
    if (sorting.by === SortBy.DATE) {
      orderBy = { createdAt: sorting.order || 'desc' };
    } else if (sorting.by === SortBy.PRICE) {
      orderBy = { totalAmount: sorting.order || 'desc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const items = orders.map((order) => {
      const item: SearchResultItem = {
        id: order.id,
        orderCode: order.orderNumber,
        status: order.status.toLowerCase(),
        totalAmount: Number(order.totalAmount),
        customer: {
          id: order.customerEmail, // Using email as ID since userId might not exist
          name: order.customerName || order.customerEmail,
        },
        createdAt: order.createdAt,
        paymentStatus: order.paymentStatus.toLowerCase(),
      };

      if (query) {
        const { score, matchedFields } = this.calculateRelevanceScore(order, query);
        item.relevanceScore = score;
        item.matchedFields = matchedFields;
      }

      return item;
    });

    return {
      count: total,
      items,
    };
  }

  /**
   * Search customers/users
   */
  private async searchCustomers(
    tenantId: string,
    query: string | undefined,
    filters: any,
    skip: number,
    limit: number,
    sorting: any,
  ): Promise<EntitySearchResult> {
    const where: Prisma.UserWhereInput = {
      tenantId,
    };

    // Text search
    if (query && query.trim()) {
      const searchQuery = query.trim();
      where.OR = [
        { email: { contains: searchQuery, mode: 'insensitive' } },
        { name: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    // Filters
    if (filters) {
      if (filters.status && filters.status.length > 0) {
        // Note: User model doesn't have status field, so we'll skip this filter
        // You might need to add a status field or use a different approach
      }

      if (filters.dateFrom) {
        where.createdAt = { ...where.createdAt, gte: new Date(filters.dateFrom) };
      }

      if (filters.dateTo) {
        where.createdAt = { ...where.createdAt, lte: new Date(filters.dateTo) };
      }
    }

    // Build orderBy
    let orderBy: Prisma.UserOrderByInput = {};
    if (sorting.by === SortBy.DATE) {
      orderBy = { createdAt: sorting.order || 'desc' };
    } else if (sorting.by === SortBy.NAME) {
      orderBy = { name: sorting.order || 'asc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Get order statistics for each user
    const items = await Promise.all(
      users.map(async (user) => {
        const orderStats = await this.prisma.order.aggregate({
          where: {
            tenantId,
            customerEmail: user.email,
          },
          _count: true,
          _sum: {
            totalAmount: true,
          },
        });

        const item: SearchResultItem = {
          id: user.id,
          name: user.name || user.email,
          email: user.email,
          phone: null, // User model doesn't have phone field
          status: 'active', // Default status
          totalOrders: orderStats._count,
          totalSpent: orderStats._sum.totalAmount
            ? Number(orderStats._sum.totalAmount)
            : 0,
          createdAt: user.createdAt,
        };

        if (query) {
          const { score, matchedFields } = this.calculateRelevanceScore(user, query);
          item.relevanceScore = score;
          item.matchedFields = matchedFields;
        }

        return item;
      }),
    );

    return {
      count: total,
      items,
    };
  }

  /**
   * Calculate relevance score for a search result
   */
  private calculateRelevanceScore(item: any, query: string): {
    score: number;
    matchedFields: string[];
  } {
    const queryLower = query.toLowerCase();
    let score = 0;
    const matchedFields: string[] = [];

    // Exact match in name/title: 1.0
    if (item.name && item.name.toLowerCase() === queryLower) {
      score += 1.0;
      matchedFields.push('name');
    } else if (item.name && item.name.toLowerCase().includes(queryLower)) {
      score += 0.8;
      matchedFields.push('name');
    }

    // Exact match in ID: 0.9
    if (item.id && item.id.toLowerCase().includes(queryLower)) {
      score += 0.9;
      matchedFields.push('id');
    }

    // Match in description: 0.5
    if (item.description && item.description.toLowerCase().includes(queryLower)) {
      score += 0.5;
      matchedFields.push('description');
    }

    // Match in email: 0.7
    if (item.email && item.email.toLowerCase().includes(queryLower)) {
      score += 0.7;
      matchedFields.push('email');
    }

    // Match in SKU/orderCode: 0.8
    if (item.sku && item.sku.toLowerCase().includes(queryLower)) {
      score += 0.8;
      matchedFields.push('sku');
    }
    if (item.orderCode && item.orderCode.toLowerCase().includes(queryLower)) {
      score += 0.8;
      matchedFields.push('orderCode');
    }

    return {
      score: Math.min(score, 1.0),
      matchedFields: [...new Set(matchedFields)],
    };
  }

  /**
   * Calculate aggregations for search results
   */
  private async calculateAggregations(
    tenantId: string,
    filters: any,
    entities: EntityType[],
  ): Promise<any> {
    const aggregations: any = {};

    if (entities.includes(EntityType.PRODUCTS)) {
      const productWhere: Prisma.ProductWhereInput = { tenantId };

      if (filters.products?.category) {
        productWhere.categories = {
          some: {
            categoryId: { in: filters.products.category },
          },
        };
      }

      const [priceStats, categoryCounts] = await Promise.all([
        this.prisma.product.aggregate({
          where: productWhere,
          _min: { price: true },
          _max: { price: true },
        }),
        this.prisma.productCategory.groupBy({
          by: ['categoryId'],
          where: {
            product: productWhere,
          },
          _count: true,
        }),
      ]);

      aggregations.products = {
        priceRange: {
          min: priceStats._min.price ? Number(priceStats._min.price) : 0,
          max: priceStats._max.price ? Number(priceStats._max.price) : 0,
        },
        categories: await Promise.all(
          categoryCounts.map(async (cat) => {
            const category = await this.prisma.category.findUnique({
              where: { id: cat.categoryId },
            });
            return {
              id: cat.categoryId,
              name: category?.name || 'Unknown',
              count: cat._count,
            };
          }),
        ),
      };
    }

    if (entities.includes(EntityType.ORDERS)) {
      const orderWhere: Prisma.OrderWhereInput = { tenantId };

      const [amountStats, statusCounts] = await Promise.all([
        this.prisma.order.aggregate({
          where: orderWhere,
          _min: { totalAmount: true },
          _max: { totalAmount: true },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: orderWhere,
          _count: true,
        }),
      ]);

      aggregations.orders = {
        amountRange: {
          min: amountStats._min.totalAmount ? Number(amountStats._min.totalAmount) : 0,
          max: amountStats._max.totalAmount ? Number(amountStats._max.totalAmount) : 0,
        },
        statuses: statusCounts.map((stat) => ({
          status: stat.status.toLowerCase(),
          count: stat._count,
        })),
      };
    }

    return aggregations;
  }

  /**
   * Get search history
   */
  async getSearchHistory(
    tenantId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
    entity?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.SearchHistoryWhereInput = {
      tenantId,
      userId,
    };

    if (entity) {
      where.entity = entity;
    }

    const [history, total] = await Promise.all([
      this.prisma.searchHistory.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.searchHistory.count({ where }),
    ]);

    return {
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      history: history.map((h) => ({
        id: h.id,
        query: h.query,
        entities: h.entities,
        filters: h.filters as any,
        resultCount: h.resultCount,
        createdAt: h.createdAt,
        entity: h.entity,
      })),
    };
  }

  /**
   * Save search to history
   */
  async saveSearchHistory(
    tenantId: string,
    userId: string,
    data: SaveSearchHistoryDto,
  ) {
    const searchHistory = await this.prisma.searchHistory.create({
      data: {
        userId,
        tenantId,
        query: data.query,
        entities: data.entities || [],
        filters: data.filters as any,
        resultCount: data.resultCount || 0,
        entity: data.entities?.[0] || null,
      },
    });

    return {
      success: true,
      message: 'Search saved to history',
      searchHistory: {
        id: searchHistory.id,
        query: searchHistory.query,
        entities: searchHistory.entities,
        filters: searchHistory.filters,
        resultCount: searchHistory.resultCount,
        createdAt: searchHistory.createdAt,
      },
    };
  }

  /**
   * Delete search history
   */
  async deleteSearchHistory(
    tenantId: string,
    userId: string,
    data: DeleteSearchHistoryDto,
  ) {
    const where: Prisma.SearchHistoryWhereInput = {
      tenantId,
      userId,
    };

    if (data.clearAll) {
      // Delete all history for user
      const result = await this.prisma.searchHistory.deleteMany({ where });
      return {
        success: true,
        message: 'Search history deleted successfully',
        deletedCount: result.count,
      };
    } else if (data.ids && data.ids.length > 0) {
      // Delete specific entries
      where.id = { in: data.ids };
      const result = await this.prisma.searchHistory.deleteMany({ where });
      return {
        success: true,
        message: 'Search history deleted successfully',
        deletedCount: result.count,
      };
    } else if (data.id) {
      // Delete single entry
      const result = await this.prisma.searchHistory.deleteMany({
        where: { ...where, id: data.id },
      });
      return {
        success: true,
        message: 'Search history deleted successfully',
        deletedCount: result.count,
      };
    } else {
      throw new BadRequestException('No deletion criteria provided');
    }
  }

  /**
   * Get search suggestions/autocomplete
   */
  async getSearchSuggestions(
    tenantId: string,
    query: string,
    entities: EntityType[] = [EntityType.PRODUCTS, EntityType.ORDERS, EntityType.CUSTOMERS],
    limit: number = 10,
  ) {
    const suggestions: any[] = [];
    const queryLower = query.toLowerCase();

    if (entities.includes(EntityType.PRODUCTS)) {
      const products = await this.prisma.product.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { nameAr: { contains: query, mode: 'insensitive' } },
            { sku: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          name: true,
          nameAr: true,
          categories: {
            include: {
              category: {
                select: {
                  name: true,
                },
              },
            },
            take: 1,
          },
        },
      });

      products.forEach((product) => {
        suggestions.push({
          text: product.name || product.nameAr,
          type: 'product',
          entityId: product.id,
          category: product.categories[0]?.category?.name || 'Uncategorized',
        });
      });
    }

    if (entities.includes(EntityType.ORDERS)) {
      const orders = await this.prisma.order.findMany({
        where: {
          tenantId,
          orderNumber: { contains: query, mode: 'insensitive' },
        },
        take: limit,
        select: {
          id: true,
          orderNumber: true,
        },
      });

      orders.forEach((order) => {
        suggestions.push({
          text: order.orderNumber,
          type: 'order',
          entityId: order.id,
          category: 'Orders',
        });
      });
    }

    if (entities.includes(EntityType.CUSTOMERS)) {
      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      users.forEach((user) => {
        suggestions.push({
          text: user.name || user.email,
          type: 'customer',
          entityId: user.id,
          category: 'Customers',
        });
      });
    }

    // Sort by relevance (exact matches first)
    suggestions.sort((a, b) => {
      const aExact = a.text.toLowerCase().startsWith(queryLower) ? 1 : 0;
      const bExact = b.text.toLowerCase().startsWith(queryLower) ? 1 : 0;
      return bExact - aExact;
    });

    return {
      success: true,
      query,
      suggestions: suggestions.slice(0, limit),
    };
  }
}


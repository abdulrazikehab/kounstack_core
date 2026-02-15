import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Request,
  UseGuards,
  Headers,
  BadRequestException,
  UnauthorizedException,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { MerchantSearchService } from '../services/merchant-search.service';
import {
  SearchRequestDto,
  SaveSearchHistoryDto,
  DeleteSearchHistoryDto,
  SearchSuggestionsQueryDto,
  EntityType,
  SortBy,
  SortOrder,
} from '../dto/search.dto';
import { AuthenticatedRequest } from '../../types/request.types';

@Controller('merchant/search')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MerchantSearchController {
  private readonly logger = new Logger(MerchantSearchController.name);

  constructor(private readonly searchService: MerchantSearchService) {}

  /**
   * GET /api/merchant/search
   * Search across multiple entities with query parameters
   */
  @Get()
  async searchGet(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('q') query?: string,
    @Query('entities') entities?: string | string[],
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    // Product filters
    @Query('productCategory') productCategory?: string | string[],
    @Query('productPriceMin') productPriceMin?: string,
    @Query('productPriceMax') productPriceMax?: string,
    @Query('productStatus') productStatus?: string | string[],
    @Query('productFeatured') productFeatured?: string,
    @Query('productInStock') productInStock?: string,
    // Order filters
    @Query('orderStatus') orderStatus?: string | string[],
    @Query('paymentStatus') paymentStatus?: string | string[],
    @Query('orderDateFrom') orderDateFrom?: string,
    @Query('orderDateTo') orderDateTo?: string,
    @Query('orderAmountMin') orderAmountMin?: string,
    @Query('orderAmountMax') orderAmountMax?: string,
    @Query('orderCustomerId') orderCustomerId?: string | string[],
    // Customer filters
    @Query('customerStatus') customerStatus?: string | string[],
    @Query('customerDateFrom') customerDateFrom?: string,
    @Query('customerDateTo') customerDateTo?: string,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      // Parse entities
      let entityArray: EntityType[] = [];
      if (entities) {
        const entitiesArray = Array.isArray(entities) ? entities : [entities];
        entityArray = entitiesArray
          .filter((e) => Object.values(EntityType).includes(e as EntityType))
          .map((e) => e as EntityType);
      }

      if (entityArray.length === 0) {
        entityArray = [EntityType.PRODUCTS, EntityType.ORDERS, EntityType.CUSTOMERS];
      }

      // Build filters object
      const filters: any = {};

      // Product filters
      if (productCategory || productPriceMin || productPriceMax || productStatus || productFeatured || productInStock) {
        filters.products = {};
        if (productCategory) {
          filters.products.category = Array.isArray(productCategory) ? productCategory : [productCategory];
        }
        if (productPriceMin) {
          filters.products.priceMin = parseFloat(productPriceMin);
        }
        if (productPriceMax) {
          filters.products.priceMax = parseFloat(productPriceMax);
        }
        if (productStatus) {
          filters.products.status = Array.isArray(productStatus) ? productStatus : [productStatus];
        }
        if (productFeatured !== undefined) {
          filters.products.featured = productFeatured === 'true';
        }
        if (productInStock !== undefined) {
          filters.products.inStock = productInStock === 'true';
        }
      }

      // Order filters
      if (orderStatus || paymentStatus || orderDateFrom || orderDateTo || orderAmountMin || orderAmountMax || orderCustomerId) {
        filters.orders = {};
        if (orderStatus) {
          filters.orders.status = Array.isArray(orderStatus) ? orderStatus : [orderStatus];
        }
        if (paymentStatus) {
          filters.orders.paymentStatus = Array.isArray(paymentStatus) ? paymentStatus : [paymentStatus];
        }
        if (orderDateFrom) {
          filters.orders.dateFrom = orderDateFrom;
        }
        if (orderDateTo) {
          filters.orders.dateTo = orderDateTo;
        }
        if (orderAmountMin) {
          filters.orders.amountMin = parseFloat(orderAmountMin);
        }
        if (orderAmountMax) {
          filters.orders.amountMax = parseFloat(orderAmountMax);
        }
        if (orderCustomerId) {
          filters.orders.customerId = Array.isArray(orderCustomerId) ? orderCustomerId : [orderCustomerId];
        }
      }

      // Customer filters
      if (customerStatus || customerDateFrom || customerDateTo) {
        filters.customers = {};
        if (customerStatus) {
          filters.customers.status = Array.isArray(customerStatus) ? customerStatus : [customerStatus];
        }
        if (customerDateFrom) {
          filters.customers.dateFrom = customerDateFrom;
        }
        if (customerDateTo) {
          filters.customers.dateTo = customerDateTo;
        }
      }

      const searchRequest: SearchRequestDto = {
        query,
        entities: entityArray,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        pagination: {
          page: page || 1,
          limit: Math.min(limit || 20, 100),
        },
        sorting: {
          by: (sortBy as SortBy) || SortBy.RELEVANCE,
          order: (sortOrder as SortOrder) || SortOrder.DESC,
        },
      };

      return await this.searchService.search(authenticatedTenantId, authenticatedUserId, searchRequest);
    } catch (error: any) {
      this.logger.error(`Error in searchGet endpoint: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to perform search');
    }
  }

  /**
   * POST /api/merchant/search
   * Search with complex filters in request body
   */
  @Post()
  async searchPost(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Body() searchRequest: SearchRequestDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.searchService.search(authenticatedTenantId, authenticatedUserId, searchRequest);
    } catch (error: any) {
      this.logger.error(`Error in searchPost endpoint: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to perform search');
    }
  }

  /**
   * GET /api/merchant/search/history
   * Get search history
   */
  @Get('history')
  async getSearchHistory(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('entity') entity?: string,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.searchService.getSearchHistory(
        authenticatedTenantId,
        authenticatedUserId,
        page || 1,
        Math.min(limit || 20, 100),
        entity,
      );
    } catch (error: any) {
      this.logger.error(`Error in getSearchHistory endpoint: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to get search history');
    }
  }

  /**
   * POST /api/merchant/search/history
   * Save search to history
   */
  @Post('history')
  async saveSearchHistory(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Body() data: SaveSearchHistoryDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.searchService.saveSearchHistory(authenticatedTenantId, authenticatedUserId, data);
    } catch (error: any) {
      this.logger.error(`Error in saveSearchHistory endpoint: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to save search history');
    }
  }

  /**
   * DELETE /api/merchant/search/history
   * Delete search history
   */
  @Delete('history')
  async deleteSearchHistory(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('id') id?: string,
    @Body() data?: DeleteSearchHistoryDto,
  ) {
    try {
      const authenticatedUserId = req.user?.id;
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedUserId) {
        throw new UnauthorizedException('User not authenticated');
      }

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      const deleteData: DeleteSearchHistoryDto = {
        ...data,
        id: id || data?.id,
      };

      return await this.searchService.deleteSearchHistory(authenticatedTenantId, authenticatedUserId, deleteData);
    } catch (error: any) {
      this.logger.error(`Error in deleteSearchHistory endpoint: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to delete search history');
    }
  }

  /**
   * GET /api/merchant/search/suggestions
   * Get search suggestions/autocomplete
   */
  @Get('suggestions')
  async getSearchSuggestions(
    @Request() req: AuthenticatedRequest,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query() query: SearchSuggestionsQueryDto,
  ) {
    try {
      const authenticatedTenantId = req.tenantId || tenantIdHeader || req.user?.tenantId;

      if (!authenticatedTenantId) {
        throw new BadRequestException('Tenant ID is required');
      }

      return await this.searchService.getSearchSuggestions(
        authenticatedTenantId,
        query.q,
        query.entities,
        query.limit || 10,
      );
    } catch (error: any) {
      this.logger.error(`Error in getSearchSuggestions endpoint: ${error.message}`, error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to get search suggestions');
    }
  }
}


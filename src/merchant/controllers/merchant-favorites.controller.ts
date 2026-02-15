import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { MerchantFavoritesService } from '../services/merchant-favorites.service';
import { MerchantService } from '../services/merchant.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { AddFavoriteDto, FavoritesListQuery } from '../dto';

@Controller('merchant/favorites')
@UseGuards(JwtAuthGuard)
export class MerchantFavoritesController {
  constructor(
    private readonly favoritesService: MerchantFavoritesService,
    private readonly merchantService: MerchantService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: FavoritesListQuery,
  ) {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        throw new BadRequestException('User authentication required');
      }
      const context = await this.merchantService.validateMerchantAccess(userId);
      return this.favoritesService.findAll(context.merchantId, query);
    } catch (error) {
      return []; // Return empty array if merchant access fails
    }
  }

  @Post()
  async add(
    @Request() req: any,
    @Body() dto: AddFavoriteDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.favoritesService.add(context.merchantId, dto);
  }

  @Delete()
  async remove(
    @Request() req: any,
    @Body() dto: AddFavoriteDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.favoritesService.remove(context.merchantId, dto);
  }
}


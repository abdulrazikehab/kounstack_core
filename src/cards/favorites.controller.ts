import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { Public } from '../auth/public.decorator';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getFavorites(@Request() req: any) {
    // Support both user (dashboard) and customer (storefront) authentication
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.favoritesService.getUserFavorites(userId);
  }

  @Post(':productId')
  @UseGuards(JwtAuthGuard)
  async addFavorite(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.favoritesService.addFavorite(userId, productId);
  }

  @Delete(':productId')
  @UseGuards(JwtAuthGuard)
  async removeFavorite(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.favoritesService.removeFavorite(userId, productId);
  }

  @Post(':productId/toggle')
  @UseGuards(JwtAuthGuard)
  async toggleFavorite(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.favoritesService.toggleFavorite(userId, productId);
  }

  @Get(':productId/check')
  @UseGuards(JwtAuthGuard)
  async checkFavorite(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!userId) {
      return { isFavorite: false };
    }
    const isFavorite = await this.favoritesService.isFavorite(userId, productId);
    return { isFavorite };
  }
}


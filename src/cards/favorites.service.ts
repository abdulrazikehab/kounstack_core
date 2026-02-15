import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(private prisma: PrismaService) {}

  // Add product to favorites
  async addFavorite(userId: string, productId: string) {
    // Check if product exists
    const product = await this.prisma.cardProduct.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check if already favorited
    const existing = await this.prisma.merchantFavorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Product already in favorites');
    }

    const favorite = await this.prisma.merchantFavorite.create({
      data: {
        userId,
        productId,
      },
      include: {
        product: {
          include: {
            brand: true,
            category: true,
          },
        },
      },
    });

    this.logger.log(`User ${userId} added product ${productId} to favorites`);
    return favorite;
  }

  // Remove product from favorites
  async removeFavorite(userId: string, productId: string) {
    const existing = await this.prisma.merchantFavorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Favorite not found');
    }

    await this.prisma.merchantFavorite.delete({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    this.logger.log(`User ${userId} removed product ${productId} from favorites`);
    return { success: true };
  }

  // Get user's favorites
  async getUserFavorites(userId: string) {
    const favorites = await this.prisma.merchantFavorite.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            brand: true,
            category: true,
            _count: {
              select: {
                inventory: { where: { status: 'AVAILABLE' } },
              },
            },
          },
        },
      },
      orderBy: { addedAt: 'desc' },
    });

    return favorites.map((f) => ({
      ...f,
      product: {
        ...f.product,
        availableStock: f.product._count.inventory,
      },
    }));
  }

  // Check if product is in favorites
  async isFavorite(userId: string, productId: string): Promise<boolean> {
    const favorite = await this.prisma.merchantFavorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    return !!favorite;
  }

  // Toggle favorite status
  async toggleFavorite(userId: string, productId: string) {
    const isFav = await this.isFavorite(userId, productId);

    if (isFav) {
      await this.removeFavorite(userId, productId);
      return { isFavorite: false };
    } else {
      await this.addFavorite(userId, productId);
      return { isFavorite: true };
    }
  }
}


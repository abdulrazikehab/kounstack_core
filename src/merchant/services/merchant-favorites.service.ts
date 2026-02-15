import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddFavoriteDto, FavoritesListQuery } from '../dto';

@Injectable()
export class MerchantFavoritesService {
  private readonly logger = new Logger(MerchantFavoritesService.name);

  constructor(private prisma: PrismaService) {}

  // Get all favorites
  async findAll(merchantId: string, query: FavoritesListQuery) {
    const where: any = { merchantId };

    if (query.type) {
      where.type = query.type.toUpperCase();
    }

    const favorites = await this.prisma.merchantFavoriteV2.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
            costPerItem: true,
            price: true,
            brand: { select: { name: true } },
          },
        },

        player: {
          select: {
            id: true,
            name: true,
            phone: true,
            _count: { select: { gameAccounts: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((f: any) => ({
      id: f.id,
      type: f.type.toLowerCase() as 'product' | 'player',
      refId: f.productId || f.playerId,
      snapshot: f.type === 'PRODUCT' && f.product
        ? {
            id: f.product.id,
            name: f.product.name,
            nameAr: f.product.nameAr,
            image: f.product.images?.[0]?.url || null,
            wholesalePrice: Number(f.product.costPerItem || f.product.price),
            currency: 'SAR', // Fallback for Product
            brandName: f.product.brand?.name,
          }

        : f.type === 'PLAYER' && f.player
        ? {
            id: f.player.id,
            name: f.player.name,
            phone: f.player.phone,
            accountsCount: f.player._count.gameAccounts,
          }
        : null,
      createdAt: f.createdAt,
    }));
  }

  // Add favorite
  async add(merchantId: string, dto: AddFavoriteDto) {
    const type = dto.type.toUpperCase() as 'PRODUCT' | 'PLAYER';

    // Validate reference exists
    if (type === 'PRODUCT') {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.refId },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      // Check if already favorited
      const existing = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_productId: { merchantId, type, productId: dto.refId } },
      });
      if (existing) {
        throw new ConflictException('Already in favorites');
      }

      await this.prisma.merchantFavoriteV2.create({
        data: { merchantId, type, productId: dto.refId },
      });
    } else {
      const player = await this.prisma.player.findFirst({
        where: { id: dto.refId, merchantId },
      });
      if (!player) {
        throw new NotFoundException('Player not found');
      }

      // Check if already favorited
      const existing = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_playerId: { merchantId, type, playerId: dto.refId } },
      });
      if (existing) {
        throw new ConflictException('Already in favorites');
      }

      await this.prisma.merchantFavoriteV2.create({
        data: { merchantId, type, playerId: dto.refId },
      });
    }

    this.logger.log(`Added ${type} ${dto.refId} to favorites for merchant ${merchantId}`);

    return { ok: true };
  }

  // Remove favorite
  async remove(merchantId: string, dto: AddFavoriteDto) {
    const type = dto.type.toUpperCase() as 'PRODUCT' | 'PLAYER';

    if (type === 'PRODUCT') {
      const favorite = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_productId: { merchantId, type, productId: dto.refId } },
      });

      if (!favorite) {
        throw new NotFoundException('Favorite not found');
      }

      await this.prisma.merchantFavoriteV2.delete({
        where: { id: favorite.id },
      });
    } else {
      const favorite = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_playerId: { merchantId, type, playerId: dto.refId } },
      });

      if (!favorite) {
        throw new NotFoundException('Favorite not found');
      }

      await this.prisma.merchantFavoriteV2.delete({
        where: { id: favorite.id },
      });
    }

    this.logger.log(`Removed ${type} ${dto.refId} from favorites for merchant ${merchantId}`);

    return { ok: true };
  }

  // Check if item is favorited
  async isFavorite(merchantId: string, type: 'product' | 'player', refId: string): Promise<boolean> {
    const enumType = type.toUpperCase() as 'PRODUCT' | 'PLAYER';

    if (enumType === 'PRODUCT') {
      const favorite = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_productId: { merchantId, type: enumType, productId: refId } },
      });
      return !!favorite;
    } else {
      const favorite = await this.prisma.merchantFavoriteV2.findUnique({
        where: { merchantId_type_playerId: { merchantId, type: enumType, playerId: refId } },
      });
      return !!favorite;
    }
  }
}


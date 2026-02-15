import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlayerDto, UpdatePlayerDto, AddGameAccountDto, PlayerListQuery } from '../dto';

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name);

  constructor(private prisma: PrismaService) {}

  // Create player
  async create(merchantId: string, dto: CreatePlayerDto) {
    // Create player with accounts in transaction
    const player = await this.prisma.$transaction(async (tx: any) => {
      const newPlayer = await tx.player.create({
        data: {
          merchantId,
          name: dto.name,
          phone: dto.phone,
          notes: dto.notes,
        },
      });

      // Create game accounts if provided
      if (dto.accounts && dto.accounts.length > 0) {
        for (const account of dto.accounts) {
          await tx.playerGameAccount.create({
            data: {
              playerId: newPlayer.id,
              gameKey: account.gameKey,
              accountIdentifier: account.accountIdentifier,
              label: account.label,
            },
          });
        }
      }

      return newPlayer;
    });

    this.logger.log(`Created player ${player.id} for merchant ${merchantId}`);

    return this.findOne(merchantId, player.id);
  }

  // Get all players with pagination
  async findAll(merchantId: string, query: PlayerListQuery) {
    const limit = query.limit || 20;
    const where: any = { merchantId };

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
      ];
    }

    if (query.favorite === true) {
      where.isFavorite = true;
    }

    // Cursor-based pagination
    const cursorOptions: any = {};
    if (query.cursor) {
      cursorOptions.cursor = { id: query.cursor };
      cursorOptions.skip = 1; // Skip the cursor itself
    }

    const players = await this.prisma.player.findMany({
      where,
      include: {
        gameAccounts: { select: { id: true } },
        orders: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Get one extra to check if there are more
      ...cursorOptions,
    });

    const hasMore = players.length > limit;
    const items = hasMore ? players.slice(0, limit) : players;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((p: any) => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        notes: p.notes,
        isFavorite: p.isFavorite,
        accountsCount: p.gameAccounts.length,
        lastOrderAt: p.orders[0]?.createdAt || null,
        createdAt: p.createdAt,
      })),
      nextCursor,
    };
  }

  // Get single player with details
  async findOne(merchantId: string, playerId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
      include: {
        gameAccounts: true,
        orders: {
          select: { id: true, total: true },
        },
      },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const totalSpent = player.orders.reduce((sum: number, o: any) => sum + Number(o.total), 0);

    return {
      id: player.id,
      name: player.name,
      phone: player.phone,
      notes: player.notes,
      isFavorite: player.isFavorite,
      accountsCount: player.gameAccounts.length,
      accounts: player.gameAccounts.map((a: any) => ({
        id: a.id,
        gameKey: a.gameKey,
        accountIdentifier: a.accountIdentifier,
        label: a.label,
        createdAt: a.createdAt,
      })),
      ordersCount: player.orders.length,
      totalSpent,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    };
  }

  // Update player
  async update(merchantId: string, playerId: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data: {
        name: dto.name,
        phone: dto.phone,
        notes: dto.notes,
        isFavorite: dto.isFavorite,
      },
    });

    this.logger.log(`Updated player ${playerId}`);

    return this.findOne(merchantId, playerId);
  }

  // Delete player
  async delete(merchantId: string, playerId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    await this.prisma.player.delete({
      where: { id: playerId },
    });

    this.logger.log(`Deleted player ${playerId}`);

    return { ok: true };
  }

  // Add game account to player
  async addGameAccount(merchantId: string, playerId: string, dto: AddGameAccountDto) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    // Check for duplicate
    const existing = await this.prisma.playerGameAccount.findUnique({
      where: {
        playerId_gameKey_accountIdentifier: {
          playerId,
          gameKey: dto.gameKey,
          accountIdentifier: dto.accountIdentifier,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Game account already exists for this player');
    }

    const account = await this.prisma.playerGameAccount.create({
      data: {
        playerId,
        gameKey: dto.gameKey,
        accountIdentifier: dto.accountIdentifier,
        label: dto.label,
      },
    });

    this.logger.log(`Added game account ${account.id} to player ${playerId}`);

    return {
      id: account.id,
      gameKey: account.gameKey,
      accountIdentifier: account.accountIdentifier,
      label: account.label,
      createdAt: account.createdAt,
    };
  }

  // Remove game account
  async removeGameAccount(merchantId: string, playerId: string, accountId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const account = await this.prisma.playerGameAccount.findFirst({
      where: { id: accountId, playerId },
    });

    if (!account) {
      throw new NotFoundException('Game account not found');
    }

    await this.prisma.playerGameAccount.delete({
      where: { id: accountId },
    });

    this.logger.log(`Removed game account ${accountId} from player ${playerId}`);

    return { ok: true };
  }

  // Get player orders
  async getPlayerOrders(merchantId: string, playerId: string, page = 1, limit = 20) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, merchantId },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const [orders, total] = await Promise.all([
      this.prisma.merchantOrder.findMany({
        where: { merchantId, playerId },
        include: {
          items: {
            include: {
              product: { select: { name: true, nameAr: true, image: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.merchantOrder.count({
        where: { merchantId, playerId },
      }),
    ]);

    return {
      data: orders.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: Number(o.total),
        currency: o.currency,
        itemsCount: o.items.length,
        createdAt: o.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}


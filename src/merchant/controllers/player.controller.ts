import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PlayerService } from '../services/player.service';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { CreatePlayerDto, UpdatePlayerDto, AddGameAccountDto, PlayerListQuery } from '../dto';

@Controller('merchant/players')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class PlayerController {
  constructor(
    private readonly playerService: PlayerService,
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: PlayerListQuery,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.playerService.findAll(context.merchantId, query);
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() dto: CreatePlayerDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'playersWrite');

    const player = await this.playerService.create(context.merchantId, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.PLAYER_CREATED,
      'Player',
      player.id,
      { name: dto.name },
    );

    return player;
  }

  @Get(':id')
  async findOne(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.playerService.findOne(context.merchantId, id);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePlayerDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'playersWrite');

    const player = await this.playerService.update(context.merchantId, id, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.PLAYER_UPDATED,
      'Player',
      id,
      { changes: dto },
    );

    return player;
  }

  @Delete(':id')
  async delete(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'playersWrite');

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.PLAYER_DELETED,
      'Player',
      id,
    );

    return this.playerService.delete(context.merchantId, id);
  }

  @Post(':id/accounts')
  async addGameAccount(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AddGameAccountDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'playersWrite');

    return this.playerService.addGameAccount(context.merchantId, id, dto);
  }

  @Delete(':id/accounts/:accountId')
  async removeGameAccount(
    @Request() req: any,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'playersWrite');

    return this.playerService.removeGameAccount(context.merchantId, id, accountId);
  }

  @Get(':id/orders')
  async getPlayerOrders(
    @Request() req: any,
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId, 'ordersRead');

    return this.playerService.getPlayerOrders(
      context.merchantId,
      id,
      parseInt(page),
      parseInt(limit),
    );
  }
}


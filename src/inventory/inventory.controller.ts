import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  DefaultValuePipe
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { CreateEmergencyItemDto, BulkEmergencyItemsDto } from './dto/create-emergency-item.dto';
import { BulkUpdateVisibilityDto } from './dto/update-visibility.dto';
import { InventoryType, EntityType } from '@prisma/client';
import { Roles } from '../decorator/roles.decorator';
import { RolesGuard } from '../guard/roles.guard';
import { UserRole } from '../types/user-role.enum';

@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_OWNER, UserRole.STAFF, UserRole.SUPER_ADMIN)
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(private readonly inventoryService: InventoryService) {}

  private ensureTenantId(req: AuthenticatedRequest): string {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return tenantId;
  }

  @Post('emergency/bulk')
  @HttpCode(HttpStatus.OK)
  async upsertEmergencyItems(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BulkEmergencyItemsDto,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.upsertEmergencyItems(tenantId, dto.items);
  }

  @Get('emergency')
  async getEmergencyInventory(
    @Request() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.getEmergencyInventory(tenantId, page, limit, search);
  }

  @Delete('emergency/:productId')
  async removeEmergencyItem(
    @Request() req: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.removeEmergencyItem(tenantId, productId);
  }

  @Post('emergency/auto-add-cost-gt-price')
  async autoAddCostGtPrice(
    @Request() req: AuthenticatedRequest,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.autoAddCostGtPrice(tenantId);
  }

  @Post('emergency/auto-add-needed')
  async autoAddNeeded(
    @Request() req: AuthenticatedRequest,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.autoAddNeeded(tenantId);
  }

  @Get('setup')
  async getSetup(
    @Request() req: AuthenticatedRequest,
    @Query('inventoryType') inventoryType: InventoryType,
    @Query('entityType') entityType: EntityType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
     if (!inventoryType || !entityType) {
         throw new BadRequestException('inventoryType and entityType are required');
     }
     const tenantId = this.ensureTenantId(req);
     return this.inventoryService.getSetup(tenantId, inventoryType, entityType, page, limit, search);
  }

  @Put('visibility')
  async updateVisibility(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BulkUpdateVisibilityDto,
  ) {
    const tenantId = this.ensureTenantId(req);
    return this.inventoryService.updateVisibility(tenantId, dto);
  }
}

import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, Logger } from '@nestjs/common';
import { UnitService, CreateUnitDto, UpdateUnitDto } from './unit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@UseGuards(JwtAuthGuard)
@Controller('units')
export class UnitController {
  private readonly logger = new Logger(UnitController.name);

  constructor(private readonly unitService: UnitService) {}

  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() data: CreateUnitDto) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.unitService.create(tenantId, data);
  }

  @Get()
  async findAll(@Request() req: AuthenticatedRequest) {
    try {
      // Check if user is authenticated
      if (!req.user) {
        this.logger.warn('User not authenticated in units findAll');
        throw new BadRequestException('Authentication required. Please log in.');
      }
      
      // Get tenantId from user or request context
      const tenantId = req.user?.tenantId || req.tenantId;
      
      if (!tenantId || tenantId === 'default' || tenantId === 'system') {
        this.logger.warn('Tenant ID missing or invalid in request', { 
          userId: req.user?.id,
          userTenantId: req.user?.tenantId, 
          reqTenantId: req.tenantId 
        });
        throw new BadRequestException(
          'You must set up a market first. Please go to Market Setup to create your store, then log out and log back in to refresh your session.'
        );
      }
      
      return this.unitService.findAll(tenantId);
    } catch (error: any) {
      this.logger.error('Error in findAll units:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch units: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get(':id')
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.unitService.findOne(tenantId, id);
  }

  @Get('code/:code')
  async findByCode(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.unitService.findByCode(tenantId, code);
  }

  @Put(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateUnitDto,
  ) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.unitService.update(tenantId, id, data);
  }

  @Delete(':id')
  async remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user.tenantId || req.user.id;
    return this.unitService.remove(tenantId, id);
  }
}


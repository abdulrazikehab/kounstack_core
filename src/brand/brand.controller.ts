import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Headers, Query } from '@nestjs/common';
import { BrandService, CreateBrandDto, UpdateBrandDto } from './brand.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';

@UseGuards(JwtAuthGuard)
@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() data: CreateBrandDto) {
    const tenantId = req.user.tenantId || ((req as any).headers['x-tenant-id'] as string);
    return this.brandService.create(tenantId, data);
  }

  @Public()
  @Get()
  async findAll(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    // Support both authenticated and public access
    // IMPORTANT: Never fall back to user.id as tenantId – it's not a valid tenant identifier.
    // Prefer an explicitly resolved tenantId (from middleware or header).
    const tenantId =
      req.tenantId ||
      req.user?.tenantId ||
      tenantIdHeader ||
      process.env.DEFAULT_TENANT_ID ||
      'default';

    console.log(`[BrandController] findAll for tenantId: ${tenantId}`);

    if (!tenantId || tenantId === 'system') {
      // Return empty array if no valid tenant
      return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    }
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    
    try {
      return await this.brandService.findAll(tenantId, pageNum, limitNum);
    } catch (error: any) {
      console.error(`[BrandController] Error fetching brands:`, error);
      console.error(`Error details:`, {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
      });
      throw error;
    }
  }

  @Get(':id')
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId =
      (req as any).tenantId ||
      req.user?.tenantId ||
      ((req as any).headers['x-tenant-id'] as string) ||
      process.env.DEFAULT_TENANT_ID ||
      'default';
    return this.brandService.findOne(tenantId, id);
  }

  @Get('code/:code')
  async findByCode(@Request() req: AuthenticatedRequest, @Param('code') code: string) {
    const tenantId =
      (req as any).tenantId ||
      req.user?.tenantId ||
      ((req as any).headers['x-tenant-id'] as string) ||
      process.env.DEFAULT_TENANT_ID ||
      'default';
    return this.brandService.findByCode(tenantId, code);
  }

  @Put(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateBrandDto,
  ) {
    const tenantId =
      (req as any).tenantId ||
      req.user?.tenantId ||
      ((req as any).headers['x-tenant-id'] as string) ||
      process.env.DEFAULT_TENANT_ID ||
      'default';
    
    console.log(`[BrandController] PUT /brands/${id} for tenantId: ${tenantId}`);
    
    try {
      return await this.brandService.update(tenantId, id, data);
    } catch (error: any) {
      console.error(`[BrandController] Error updating brand ${id}:`, error.message);
      throw error;
    }
  }

  @Delete(':id')
  async remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId =
      (req as any).tenantId ||
      req.user?.tenantId ||
      ((req as any).headers['x-tenant-id'] as string) ||
      process.env.DEFAULT_TENANT_ID ||
      'default';
    
    console.log(`[BrandController] DELETE /brands/${id} for tenantId: ${tenantId}`);
    
    try {
      return await this.brandService.remove(tenantId, id);
    } catch (error: any) {
      console.error(`[BrandController] Error deleting brand ${id}:`, error.message);
      throw error;
    }
  }
}


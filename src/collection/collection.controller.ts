import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Headers, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CollectionService } from './collection.service';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';

@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionController {
  constructor(private collectionService: CollectionService) {}

  @Post()
  async createCollection(
    @Request() req: AuthenticatedRequest,
    @Body() body: { name: string; description?: string; image?: string },
  ) {
    return this.collectionService.createCollection(req.tenantId, body);
  }

  @Public()
  @Get()
  async getCollections(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
    return this.collectionService.getCollections(tenantId, true);
  }

  @Public()
  @Get(':id')
  async getCollection(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Param('id') id: string,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
    return this.collectionService.getCollection(tenantId, id);
  }

  @Post(':collectionId/products/:productId')
  async addProductToCollection(
    @Request() req: AuthenticatedRequest,
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
    @Body() body: { sortOrder?: number },
  ) {
    return this.collectionService.addProductToCollection(
      req.tenantId,
      collectionId,
      productId,
      body.sortOrder || 0,
    );
  }

  @Delete(':collectionId/products/:productId')
  async removeProductFromCollection(
    @Request() req: AuthenticatedRequest,
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionService.removeProductFromCollection(
      req.tenantId,
      collectionId,
      productId,
    );
  }

  @Put(':id')
  async updateCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; image?: string; isActive?: boolean },
  ) {
    return this.collectionService.updateCollection(req.tenantId, id, body);
  }

  @Delete(':id')
  async deleteCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.collectionService.deleteCollection(req.tenantId, id);
  }
}
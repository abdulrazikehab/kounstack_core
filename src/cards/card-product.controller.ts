import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CardProductService, CreateCardProductDto, UpdateCardProductDto } from './card-product.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';

@Controller('card-products')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class CardProductController {
  constructor(private readonly cardProductService: CardProductService) {}

  @Post()
  async create(@Request() req: any, @Body() body: CreateCardProductDto) {
    return this.cardProductService.create(req.tenantId, body);
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('isAvailable') isAvailable?: string,
    @Query('search') search?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    return this.cardProductService.findAll(
      req.tenantId,
      {
        brandId,
        categoryId,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isAvailable: isAvailable !== undefined ? isAvailable === 'true' : undefined,
        search,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      },
      parseInt(page),
      parseInt(limit),
    );
  }

  @Get('brands')
  async getBrands(@Request() req: any) {
    return this.cardProductService.getBrandsWithProducts(req.tenantId);
  }

  @Get('categories')
  async getCategories(@Request() req: any) {
    return this.cardProductService.getCategoriesWithProducts(req.tenantId);
  }

  @Get('brand/:brandId')
  async findByBrand(@Request() req: any, @Param('brandId') brandId: string) {
    return this.cardProductService.findByBrand(req.tenantId, brandId);
  }

  @Get('category/:categoryId')
  async findByCategory(@Request() req: any, @Param('categoryId') categoryId: string) {
    return this.cardProductService.findByCategory(req.tenantId, categoryId);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.cardProductService.findOne(req.tenantId, id);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: UpdateCardProductDto,
  ) {
    return this.cardProductService.update(req.tenantId, id, body);
  }

  @Delete(':id')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.cardProductService.delete(req.tenantId, id);
  }
}


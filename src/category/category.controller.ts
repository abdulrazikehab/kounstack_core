import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards, 
  Request,
  Headers,
  Query,
  BadRequestException,
  ForbiddenException,
  Logger
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { Public } from '../auth/public.decorator';
import { AuthenticatedRequest } from '../types/request.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoryController {
  private readonly logger = new Logger(CategoryController.name);
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService
  ) {}

  private ensureTenantId(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required. Please log out and log back in to refresh your session.');
    }
    return tenantId;
  }

  @Public()
  @Get()
  async getCategories(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('allFields') allFields: string = 'false',
  ) {
    try {
      const tenantId = req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit) || 20;
      const skip = (pageNum - 1) * limitNum;
      const includeAllFields = allFields === 'true';

      // Count total first
      const total = await this.prisma.category.count({ 
        where: { tenantId, isActive: true } 
      }).catch(() => 0);

      // Select fields based on allFields parameter
      const baseQuery: any = {
        where: { 
          tenantId,
          isActive: true // Only return active categories
        },
        orderBy: { name: 'asc' },
        skip,
        take: limitNum,
      };

      if (includeAllFields) {
        // Return all fields when allFields=true
        const categories = await this.prisma.category.findMany(baseQuery);
        const productCounts = await Promise.all(
          categories.map(cat => 
            this.prisma.productCategory.count({
              where: { categoryId: cat.id }
            })
          )
        );
        
        const mappedCategories = categories.map((c: any, index: number) => ({
          ...c,
          productCount: productCounts[index] || 0
        }));
        
        return { 
          categories: mappedCategories,
          meta: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
          }
        };
      }

      // Default: return selected fields only
      baseQuery.select = {
          id: true,
          name: true,
          nameAr: true,
          slug: true,
          description: true,
          descriptionAr: true,
          image: true,
          createdAt: true,
          updatedAt: true,
          parentId: true,
          isActive: true,
        icon: true,
        sortOrder: true,
        minQuantity: true,
        maxQuantity: true,
        applySliderToAllProducts: true,
        priceExceed: true,
        tenantId: true,
          _count: {
            select: { products: true }
          }
      };

      const categories = await this.prisma.category.findMany(baseQuery);
      
      // Map to include productCount for frontend
      const mappedCategories = categories.map((c: any) => ({
        ...c,
        productCount: c._count?.products || 0
      }));
      
      return { 
        categories: mappedCategories,
        meta: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      };
    } catch (error: any) {
      // SECURITY FIX: Use logger instead of console.error
      this.logger.error('Error in getCategories:', error);
      
      // If tenant doesn't exist, return empty array
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return { categories: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
      }
      
      // If parentId column doesn't exist, try without it
      if (error.message?.includes('parentId') || error.code === 'P2001') {
        const tenantId = req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
        const pageNum = Number(page) || 1;
        const limitNum = Number(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        try {
          const total = await this.prisma.category.count({ 
            where: { tenantId, isActive: true } 
          }).catch(() => 0);

          const categories = await this.prisma.category.findMany({
            where: { 
              tenantId,
              isActive: true // Only return active categories
            },
            select: {
              id: true,
              name: true,
              nameAr: true,
              slug: true,
              description: true,
              descriptionAr: true,
              image: true,
              createdAt: true,
              updatedAt: true,
              isActive: true,
              _count: {
                select: { products: true }
              }
            },
            orderBy: { name: 'asc' },
            skip,
            take: limitNum,
          });
          
          const mappedCategories = categories.map((c: any) => ({
            ...c,
            productCount: c._count.products,
            parentId: null
          }));
          
          return { 
            categories: mappedCategories,
            meta: {
              total,
              page: pageNum,
              limit: limitNum,
              totalPages: Math.ceil(total / limitNum)
            }
          };
        } catch (fallbackError: any) {
          // If tenant still doesn't exist, return empty array
          if (fallbackError?.code === 'P2003' || fallbackError?.message?.includes('Foreign key constraint')) {
            return { categories: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
          }
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  @Post()
  @UseGuards(TenantRequiredGuard)
  async createCategory(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateCategoryDto,
  ) {
    const tenantId = this.ensureTenantId(req.tenantId);
    let slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    
    // Ensure slug is unique within the same parent (subcategories under different parents can have same slug)
    // If slug exists under the same parent, append a number to make it unique
    const MAX_ATTEMPTS = 100;
    let counter = 1;
    let baseSlug = slug;
    
    while (counter <= MAX_ATTEMPTS) {
      const existingCategory = await this.prisma.category.findFirst({
        where: {
          tenantId: tenantId,
          slug: slug,
          parentId: body.parentId || null, // Check uniqueness only within the same parent
        },
      });

      if (!existingCategory) {
        break; // Slug is unique, exit loop
      }

      // Slug exists under the same parent, try with a suffix
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    if (counter > MAX_ATTEMPTS) {
      throw new BadRequestException(`Unable to generate unique slug after ${MAX_ATTEMPTS} attempts. Please choose a different name.`);
    }

    // Validate parentId if provided
    if (body.parentId) {
      const parentCategory = await this.prisma.category.findFirst({
        where: {
          id: body.parentId,
          tenantId: tenantId,
        },
      });

      if (!parentCategory) {
        throw new BadRequestException('Parent category not found');
      }
    }

    // Try to create category with all fields
    try {
      const category = await this.prisma.category.create({
        data: {
          name: body.name,
          nameAr: body.nameAr,
          description: body.description,
          descriptionAr: body.descriptionAr,
          slug: slug,
          tenantId: tenantId,
          image: body.image,
          icon: body.icon,
          parentId: body.parentId || null,
          isActive: body.isActive !== undefined ? body.isActive : true,
          sortOrder: body.sortOrder || 0,
          minQuantity: body.minQuantity,
          maxQuantity: body.maxQuantity,
          enableSlider: body.enableSlider,
          applySliderToAllProducts: body.applySliderToAllProducts,
          priceExceed: body.priceExceed,
        },
      });
      
      // Handle image renaming if it's a Cloudinary URL
      if (category.image && category.image.includes('cloudinary.com')) {
        const newImageUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
          category.image,
          `category_${category.id}`
        );
        if (newImageUrl !== category.image) {
          await this.prisma.category.update({
            where: { id: category.id },
            data: { image: newImageUrl },
          });
          category.image = newImageUrl;
        }
      }

      return { 
        message: 'Category created successfully',
        category 
      };
    } catch (error: any) {
      // Handle unique constraint violation - try with incremented slug
      if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
        // Unique constraint failed, try again with incremented slug
        counter = 1;
        let retrySlug = `${baseSlug}-${counter}`;
        
        while (counter <= MAX_ATTEMPTS) {
          try {
            const category = await this.prisma.category.create({
              data: {
                name: body.name,
                nameAr: body.nameAr,
                description: body.description,
                descriptionAr: body.descriptionAr,
                slug: retrySlug,
                tenantId: tenantId,
                image: body.image,
                icon: body.icon,
                parentId: body.parentId || null,
                isActive: body.isActive !== undefined ? body.isActive : true,
                sortOrder: body.sortOrder || 0,
                minQuantity: body.minQuantity,
                maxQuantity: body.maxQuantity,
                enableSlider: body.enableSlider,
                applySliderToAllProducts: body.applySliderToAllProducts,
                priceExceed: body.priceExceed,
              },
            });
            
            return { 
              message: 'Category created successfully',
              category 
            };
          } catch (retryError: any) {
            if (retryError.code === 'P2002' && retryError.meta?.target?.includes('slug')) {
              counter++;
              retrySlug = `${baseSlug}-${counter}`;
              continue;
            }
            throw retryError;
          }
        }
        
        throw new BadRequestException(`Unable to create category: slug conflict persists after ${MAX_ATTEMPTS} attempts`);
      }
      
      // If some columns don't exist, try with minimal fields
      if (error.message?.includes('Unknown column') || error.code === 'P2009') {
        const category = await this.prisma.category.create({
          data: {
            name: body.name,
            nameAr: body.nameAr,
            description: body.description,
            descriptionAr: body.descriptionAr,
            slug: slug,
            tenantId: tenantId,
            image: body.image,
            icon: body.icon,
            parentId: body.parentId || null,
            isActive: body.isActive !== undefined ? body.isActive : true,
            sortOrder: body.sortOrder || 0,
            minQuantity: body.minQuantity,
            maxQuantity: body.maxQuantity,
            enableSlider: body.enableSlider,
            applySliderToAllProducts: body.applySliderToAllProducts,
            priceExceed: body.priceExceed,
          } as any, // Use 'as any' to bypass TypeScript if some fields don't exist in schema
        });
        
        return { 
          message: 'Category created successfully',
          category 
        };
      }
      throw error;
    }
  }

  @Public()
  @Get(':id')
  async getCategory(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Param('id') id: string,
  ) {
    const tenantId = req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
    try {
      const category = await this.prisma.category.findFirst({
        where: {
          id: id,
          tenantId,
        },
      });

      if (!category) {
        throw new BadRequestException('Category not found');
      }

      return { category };
    } catch (error: any) {
      // If tenant doesn't exist, throw not found
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        throw new BadRequestException('Category not found: Tenant does not exist');
      }
      throw error;
    }
  }

  @Patch(':id')
  @UseGuards(TenantRequiredGuard)
  async updateCategory(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
  ) {
    const tenantId = this.ensureTenantId(req.tenantId);
    
    // Verify category exists and belongs to tenant
    const existingCategory = await this.prisma.category.findFirst({
      where: {
        id: id,
        tenantId: tenantId,
      },
    });

    if (!existingCategory) {
      throw new BadRequestException('Category not found');
    }

    // Validate parentId if provided
    if (body.parentId !== undefined) {
      if (body.parentId === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }
      
      if (body.parentId) {
        const parentCategory = await this.prisma.category.findFirst({
          where: {
            id: body.parentId,
            tenantId: tenantId,
          },
        });

        if (!parentCategory) {
          throw new BadRequestException('Parent category not found');
        }
      }
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.nameAr !== undefined) updateData.nameAr = body.nameAr;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.descriptionAr !== undefined) updateData.descriptionAr = body.descriptionAr;
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.image !== undefined) updateData.image = body.image;
    if (body.icon !== undefined) updateData.icon = body.icon;
    if (body.parentId !== undefined) updateData.parentId = body.parentId || null;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.minQuantity !== undefined) updateData.minQuantity = body.minQuantity;
    if (body.maxQuantity !== undefined) updateData.maxQuantity = body.maxQuantity;
    if (body.enableSlider !== undefined) updateData.enableSlider = body.enableSlider;
    if (body.applySliderToAllProducts !== undefined) updateData.applySliderToAllProducts = body.applySliderToAllProducts;
    if (body.priceExceed !== undefined) updateData.priceExceed = body.priceExceed;

    const category = await this.prisma.category.update({
      where: { id: id },
      data: updateData,
    });

    // Handle image renaming if it's a Cloudinary URL and was updated
    if (category.image && category.image.includes('cloudinary.com')) {
      const newImageUrl = await this.cloudinaryService.renameAndGetNewSecureUrl(
        category.image,
        `category_${category.id}`
      );
      if (newImageUrl !== category.image) {
        const renamedCategory = await this.prisma.category.update({
          where: { id: category.id },
          data: { image: newImageUrl },
        });
        return { 
          message: 'Category updated successfully',
          category: renamedCategory 
        };
      }
    }

    return { 
      message: 'Category updated successfully',
      category 
    };
  }

  @Delete(':id')
  @UseGuards(TenantRequiredGuard)
  async deleteCategory(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = this.ensureTenantId(req.tenantId);
    
    console.log(`[CategoryController] DELETE /categories/${id} for tenantId: ${tenantId}`);
    
    try {
      await this.deleteCategoryInternal(tenantId, id);
      return { message: 'Category deleted successfully' };
    } catch (error: any) {
      console.error(`[CategoryController] Error deleting category ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Internal helper for deleting a single category with all validations.
   * Allows reuse from both single and bulk delete paths.
   */
  private async deleteCategoryInternal(tenantId: string, id: string): Promise<void> {
    // Verify category exists and belongs to tenant
    const existingCategory = await this.prisma.category.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!existingCategory) {
      // Check if category exists but for different tenant
      const categoryExists = await this.prisma.category.findFirst({
        where: { id },
        select: { tenantId: true },
      });
      
      if (categoryExists) {
        console.warn(`Category ${id} exists but belongs to tenant ${categoryExists.tenantId}, not ${tenantId}`);
        throw new BadRequestException(`Category not found for tenant ${tenantId}`);
      }
      
      console.warn(`Category ${id} not found at all`);
      throw new BadRequestException(`Category ${id} not found`);
    }

    // Check if category has subcategories
    const subcategoryCount = await this.prisma.category.count({
      where: {
        parentId: id,
        tenantId,
      },
    });

    if (subcategoryCount > 0) {
      throw new BadRequestException(
        `Cannot delete category that has ${subcategoryCount} subcategory(ies). Please delete or move subcategories first.`,
      );
    }

    // Check if category has products
    const productsWithCategory = await this.prisma.productCategory.count({
      where: {
        categoryId: id,
      },
    });

    if (productsWithCategory > 0) {
      throw new BadRequestException(
        `Cannot delete category that has ${productsWithCategory} product(s). Please remove products from this category first.`,
      );
    }

    await this.prisma.category.delete({
      where: { id },
    });
  }

  @Post('bulk-delete')
  @UseGuards(TenantRequiredGuard)
  async bulkDeleteCategories(
    @Request() req: AuthenticatedRequest,
    @Body() body: { ids: string[] },
  ) {
    const tenantId = this.ensureTenantId(req.tenantId);
    
    if (!body.ids || body.ids.length === 0) {
      throw new BadRequestException('No category IDs provided');
    }

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of body.ids) {
      try {
        await this.deleteCategoryInternal(tenantId, id);
        deleted++;
      } catch (error: any) {
        failed++;
        const message = error?.message || 'Unknown error';
        errors.push(`Failed to delete category ${id}: ${message}`);
      }
    }

    return {
      message: `Bulk delete completed: ${deleted} deleted, ${failed} failed`,
      deleted,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
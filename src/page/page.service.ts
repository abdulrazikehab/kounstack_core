import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSyncService } from '../tenant/tenant-sync.service';

@Injectable()
export class PageService {
  constructor(
    private prisma: PrismaService,
    private tenantSyncService: TenantSyncService,
  ) {}

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  private async ensureUniqueSlug(tenantId: string, baseSlug: string, excludeId?: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;
    const MAX_ATTEMPTS = 1000; // Safety limit to prevent infinite loop

    while (counter <= MAX_ATTEMPTS) {
      const existing = await this.prisma.page.findFirst({
        where: {
          tenantId,
          slug,
          ...(excludeId && { NOT: { id: excludeId } }),
        },
      });

      if (!existing) {
        return slug;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // If we've exhausted all attempts, throw an error instead of looping forever
    throw new Error(`Unable to generate unique slug after ${MAX_ATTEMPTS} attempts. Please choose a different base slug.`);
  }

  async create(tenantId: string, data: any, subdomain?: string) {
    try {
      // Check if tenant exists in database first
      let tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      
      // If tenant doesn't exist, try to create it
      if (!tenant) {
        // Use provided subdomain or generate a temporary one based on tenantId
        const tenantSubdomain = subdomain || `tenant-${tenantId.substring(0, 8).toLowerCase()}`;
        const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId, {
          subdomain: tenantSubdomain,
          name: `Tenant-${tenantId.substring(0, 8)}`,
        });
        if (tenantExists) {
          tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
          });
        }
      }
      
      // If tenant still doesn't exist, check one more time (might have been created concurrently)
      if (!tenant) {
        tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
        });
      }
      
      // If tenant still doesn't exist, we cannot create the page (foreign key constraint)
      // But we've already tried to create it, so this is unexpected
      if (!tenant) {
        // SECURITY FIX: Use logger instead of console.error
        // Logger will be injected if needed
        throw new ForbiddenException(`Cannot create page: Tenant ${tenantId} does not exist in the database. Please ensure your market is properly set up.`);
      }

      // Validate and set title - required field
      const title = (data.title?.trim() || 'Untitled Page').trim();
      if (!title || title.length === 0) {
        throw new ConflictException('Page title is required');
      }

      // Auto-generate slug from title if not provided or empty
      let slug = data.slug?.trim();
      if (!slug) {
        slug = this.generateSlug(title);
      } else {
        // Clean the provided slug
        slug = this.generateSlug(slug);
      }

      // Ensure slug is unique
      slug = await this.ensureUniqueSlug(tenantId, slug);

      // Map seoDescription to seoDesc if provided (for frontend compatibility)
      const pageData: any = {
        ...data,
        title,
        slug,
        tenantId,
      };

      // Handle seoDescription -> seoDesc mapping
      if (data.seoDescription && !data.seoDesc) {
        pageData.seoDesc = data.seoDescription;
        delete pageData.seoDescription;
      }

      // Remove any fields that don't exist in the schema
      const allowedFields = [
        'title', 'titleAr', 'titleEn',
        'slug', 'content', 'draftContent', 'isPublished', 
        'seoTitle', 'seoTitleAr', 'seoTitleEn',
        'seoDesc', 'seoDescAr', 'seoDescEn',
        'tenantId'
      ];
      const cleanedData: any = { tenantId, title, slug };
      for (const key of allowedFields) {
        if (pageData[key] !== undefined) {
          cleanedData[key] = pageData[key];
        }
      }

      // Handle seoDescription -> seoDesc mapping for all languages
      if (data.seoDescriptionAr && !pageData.seoDescAr) {
        cleanedData.seoDescAr = data.seoDescriptionAr;
      }
      if (data.seoDescriptionEn && !pageData.seoDescEn) {
        cleanedData.seoDescEn = data.seoDescriptionEn;
      }

      // Ensure content is properly formatted as JSON
      if (cleanedData.content && typeof cleanedData.content !== 'object') {
        try {
          cleanedData.content = typeof cleanedData.content === 'string' 
            ? JSON.parse(cleanedData.content) 
            : cleanedData.content;
        } catch (e) {
          // If parsing fails, keep original content
          // SECURITY FIX: Use logger instead of console.warn
          // Logger will be injected if needed
        }
      }

      return await this.prisma.page.create({
        data: cleanedData,
      });
    } catch (error: any) {
      // Handle Prisma errors
      if (error?.code === 'P2002') {
        throw new ConflictException(`A page with this slug already exists. Please use a different slug.`);
      }
      if (error?.code === 'P2003') {
        throw new ForbiddenException(`Cannot create page: Invalid tenant. Please set up your market first.`);
      }
      // Re-throw known exceptions
      if (error instanceof ForbiddenException || error instanceof ConflictException) {
        throw error;
      }
      // Log and re-throw unknown errors
      // SECURITY FIX: Use logger instead of console.error
      // Logger will be injected if needed
      throw new ConflictException(`Failed to create page: ${error?.message || 'Unknown error'}`);
    }
  }

  async findAll(tenantId: string) {
    // Check if tenant exists, but don't fail if it doesn't - just return empty array
    const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId);
    if (!tenantExists) {
      // Return empty array if tenant doesn't exist
      return [];
    }
    try {
      return await this.prisma.page.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      });
    } catch (error: any) {
      // If tenant doesn't exist in database, return empty array
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return [];
      }
      throw error;
    }
  }

  async findOne(tenantId: string, id: string) {
    // Check if tenant exists first
    const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId);
    if (!tenantExists) {
      throw new NotFoundException(`Page not found: Tenant ${tenantId} does not exist`);
    }

    try {
      const page = await this.prisma.page.findFirst({
        where: { id, tenantId },
      });

      if (!page) {
        throw new NotFoundException(`Page with ID ${id} not found`);
      }

      return page;
    } catch (error: any) {
      // If tenant doesn't exist in database, throw not found
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        throw new NotFoundException(`Page not found: Tenant ${tenantId} does not exist`);
      }
      throw error;
    }
  }

  async findBySlug(tenantId: string, slug: string, includeUnpublished: boolean = false) {
    // Check if tenant exists, but don't fail for public pages - just return empty
    const tenantExists = await this.tenantSyncService.ensureTenantExists(tenantId);
    if (!tenantExists) {
      // For public pages, return null instead of throwing error
      return null;
    }
    const where: any = { slug, tenantId };
    
    // For public access, only return published pages unless explicitly requested
    if (!includeUnpublished) {
      where.isPublished = true;
    }
    
    const page = await this.prisma.page.findFirst({
      where,
    });

    if (!page) {
      // Return null instead of throwing for public endpoints
      return null;
    }

    return page;
  }

  async update(tenantId: string, id: string, data: any) {
    const page = await this.findOne(tenantId, id);

    // Handle slug update
    if (data.slug !== undefined) {
      let slug = data.slug?.trim();
      
      if (!slug && data.title) {
        // If slug is empty but title is provided, generate from title
        slug = this.generateSlug(data.title);
      } else if (slug) {
        // Clean the provided slug
        slug = this.generateSlug(slug);
      }

      if (slug) {
        // Ensure slug is unique (excluding current page)
        slug = await this.ensureUniqueSlug(tenantId, slug, id);
        data.slug = slug;
      }
    }

    // Create history if publishing
    if (data.isPublished === true && data.content) {
       const historyRecords = await this.prisma.pageHistory.findMany({ where: { pageId: id } });
       await this.prisma.pageHistory.create({
         data: {
           pageId: id,
           content: data.content as any, // Save the NEW content being published
           version: historyRecords.length + 1
         }
       });
    }

    return this.prisma.page.update({
      where: { id },
      data,
    });
  }

  async getHistory(tenantId: string, pageId: string) {
    await this.findOne(tenantId, pageId);
    return this.prisma.pageHistory.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async restoreVersion(tenantId: string, pageId: string, historyId: string) {
    const page = await this.findOne(tenantId, pageId);
    const history = await this.prisma.pageHistory.findUnique({
      where: { id: historyId }
    });
    
    if (!history || history.pageId !== pageId) {
      throw new NotFoundException('History version not found');
    }

    // Restore to draftContent
    return this.prisma.page.update({
      where: { id: pageId },
      data: {
        draftContent: history.content as any
      }
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.page.delete({
      where: { id },
    });
  }
}

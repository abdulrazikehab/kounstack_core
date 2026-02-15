import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Headers, Query, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PageService } from './page.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';
import { Public } from '../auth/public.decorator';

@Controller('pages')
export class PageController {
  constructor(private readonly pageService: PageService) {}

  private resolveTenantId(req: any, headerTenantId?: string): string {
    // Priority: 1. Middleware (subdomain/domain), 2. JWT user, 3. Header, 4. Default
    if (req.tenantId) {
      return req.tenantId;
    }
    if (req.user?.tenantId) {
      return req.user.tenantId;
    }
    if (headerTenantId) {
      return headerTenantId;
    }
    const defaultTenant = process.env.DEFAULT_TENANT_ID || 'default';
    return defaultTenant;
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, TenantRequiredGuard)
  async create(@Request() req: any, @Body() createPageDto: any, @Headers('x-tenant-domain') tenantDomain?: string) {
    const tenantId = this.resolveTenantId(req);
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new ForbiddenException('You must set up a market first before creating pages.');
    }
    
    // Extract subdomain from tenant domain header (e.g., "asus1.localhost" -> "asus1")
    let subdomain: string | undefined = undefined;
    if (tenantDomain) {
      const parts = tenantDomain.split('.');
      if (parts.length > 0 && parts[0] !== 'localhost' && parts[0] !== 'www') {
        subdomain = parts[0];
      }
    }
    
    // Log for debugging
    console.log('📄 create page - tenantId:', tenantId, {
      reqTenantId: req.tenantId,
      userTenantId: req.user?.tenantId,
      subdomain,
      tenantDomain,
      hasUser: !!req.user,
      hasToken: !!req.headers.authorization,
    });
    
    return this.pageService.create(tenantId, createPageDto, subdomain);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string
  ) {
    // Try to resolve tenant ID - now requires authentication
    const tenantId = this.resolveTenantId(req, tenantIdHeader);
    
    // Log for debugging
    console.log('📄 findAll pages - tenantId:', tenantId, {
      reqTenantId: req.tenantId,
      userTenantId: req.user?.tenantId,
      headerTenantId: tenantIdHeader,
      hasUser: !!req.user,
      hasToken: !!req.headers.authorization,
    });
    
    // If no valid tenant ID, return empty array instead of error
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      console.warn('⚠️ No valid tenant ID found, returning empty array');
      return [];
    }
    
    const pages = await this.pageService.findAll(tenantId);
    console.log('📄 Found pages:', pages?.length || 0, 'for tenant:', tenantId);
    return pages;
  }

  @Public()
  @Get('slug/:slug(*)')
  async findBySlug(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Param('slug') slug: string,
    @Query('preview') preview?: string
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      // Check if preview mode is requested (for authenticated users)
      const isPreview = preview === 'true' && req.user;
      // Decode the slug to handle URL encoding (handles nested paths like account/inventory)
      const decodedSlug = decodeURIComponent(slug);
      const page = await this.pageService.findBySlug(tenantId, decodedSlug, isPreview);
      return page || null; // Return null if page not found instead of 404
    } catch (error) {
      return null; // Return null on any error for public endpoint
    }
  }

  @Public()
  @Get(':id')
  async findOne(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Param('id') id: string
  ) {
    try {
      const tenantId = this.resolveTenantId(req, tenantIdHeader);
      if (!tenantId || tenantId === 'default' || tenantId === 'system') {
        // Try to find page without tenant restriction if no tenant found
        // This allows fetching pages by ID when tenant context is missing
        const page = await this.pageService.findOne('default', id).catch(() => null);
        if (page) return page;
        throw new NotFoundException(`Page with ID ${id} not found`);
      }
      return await this.pageService.findOne(tenantId, id);
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // If tenant-based lookup fails, try without tenant restriction
      try {
        const allPages = await this.pageService.findAll('default');
        const page = allPages.find((p: any) => p.id === id);
        if (page) return page;
      } catch {
        // Ignore
      }
      throw new NotFoundException(`Page with ID ${id} not found`);
    }
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantRequiredGuard)
  update(@Request() req: any, @Param('id') id: string, @Body() updatePageDto: any) {
    const tenantId = this.resolveTenantId(req);
    return this.pageService.update(tenantId, id, updatePageDto);
  }

  @Get(':id/history')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantRequiredGuard)
  getHistory(@Request() req: any, @Param('id') id: string) {
    const tenantId = this.resolveTenantId(req);
    return this.pageService.getHistory(tenantId, id);
  }

  @Post(':id/restore/:historyId')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantRequiredGuard)
  restoreVersion(@Request() req: any, @Param('id') id: string, @Param('historyId') historyId: string) {
    const tenantId = this.resolveTenantId(req);
    return this.pageService.restoreVersion(tenantId, id, historyId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantRequiredGuard)
  remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = this.resolveTenantId(req);
    return this.pageService.remove(tenantId, id);
  }
}

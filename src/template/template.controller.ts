// apps/app-core/src/template/template.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Delete, Patch } from '@nestjs/common';
import { TemplateService } from './template.service';
import { CreateTemplateDto, TemplateFilterDto, ApplyTemplateDto } from './dto/template.dto';
import { GenerateTemplateDto, SaveGeneratedTemplateDto } from './dto/ai-template.dto';
import { AiTemplateService } from './ai-template.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';

@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TemplateController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly aiTemplateService: AiTemplateService
  ) {}

  @Public()
  @Get()
  findAll(@Query() filter: TemplateFilterDto) {
    return this.templateService.findAll(filter);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templateService.findOne(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() createTemplateDto: CreateTemplateDto) {
    return this.templateService.create(createTemplateDto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() updateTemplateDto: Partial<CreateTemplateDto>) {
    return this.templateService.update(id, updateTemplateDto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  delete(@Param('id') id: string) {
    return this.templateService.delete(id);
  }

  /**
   * Force re-seed all default templates
   * POST /api/templates/reseed
   */
  @Roles(UserRole.SUPER_ADMIN)
  @Post('reseed')
  async reseedTemplates() {
    await this.templateService.seedTemplates();
    return { message: 'Templates reseeded successfully' };
  }

  @Post('apply/:templateId/to-page/:pageId')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  applyToPage(
    @Request() req: any,
    @Param('templateId') templateId: string,
    @Param('pageId') pageId: string
  ) {
    return this.templateService.applyToPage(req.user.tenantId, pageId, templateId);
  }

  // ========== AI TEMPLATE GENERATION ENDPOINTS ==========

  /**
   * Generate a template using AI based on user's vision
   * POST /api/templates/ai/generate
   */
  @Post('ai/generate')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async generateAiTemplate(@Body() dto: GenerateTemplateDto) {
    return this.aiTemplateService.generateTemplate(dto);
  }

  /**
   * Generate multiple template variations
   * POST /api/templates/ai/generate-variations
   */
  @Post('ai/generate-variations')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async generateVariations(
    @Body() dto: GenerateTemplateDto,
    @Query('count') count?: number
  ) {
    const variationCount = count ? parseInt(count.toString()) : 3;
    return this.aiTemplateService.generateVariations(dto, variationCount);
  }

  /**
   * Refine an existing template based on feedback
   * POST /api/templates/ai/refine
   */
  @Post('ai/refine')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async refineTemplate(
    @Body() body: { template: any; feedback: string }
  ) {
    return this.aiTemplateService.refineTemplate(body.template, body.feedback);
  }

  /**
   * Save AI-generated template to a page
   * POST /api/templates/ai/save-to-page
   */
  @Post('ai/save-to-page')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async saveGeneratedTemplate(
    @Request() req: any,
    @Body() dto: SaveGeneratedTemplateDto
  ) {
    const content = JSON.parse(dto.generatedContent);
    
    return this.templateService.applyToPage(
      req.user.tenantId,
      dto.pageId,
      content
    );
  }

  /**
   * Save AI-generated template as a reusable template
   * POST /api/templates/ai/save-as-template
   */
  @Post('ai/save-as-template')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async saveAsTemplate(
    @Body() body: { template: any; name: string; description?: string; category?: string }
  ) {
    return this.templateService.create({
      name: body.name,
      description: body.description || 'AI-generated template',
      category: body.category || 'custom',
      content: body.template.content,
      thumbnail: body.template.thumbnail,
      isDefault: false,
    });
  }
}
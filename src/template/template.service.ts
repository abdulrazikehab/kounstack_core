import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, TemplateFilterDto } from './dto/template.dto';
import { templateSeeds } from './seeds/template-seed';

@Injectable()
export class TemplateService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  private getTemplateDelegate() {
    const delegate = (this.prisma as any).template;
    if (!delegate) {
      throw new Error(
        'Prisma model "template" is not available in the current Prisma client.',
      );
    }
    return delegate;
  }

  async onModuleInit() {
    try {
      // Always reseed templates if count doesn't match (added or removed templates)
      const templateModel = this.getTemplateDelegate();
      const count = await templateModel.count({ where: { isDefault: true } });
      const expectedCount = templateSeeds.length;

      if (count !== expectedCount) {
        console.log(`🌱 Found ${count} templates but expected ${expectedCount}, reseeding...`);
        await this.seedTemplates();
      } else {
        console.log(`✅ Found ${count} default templates in database`);
      }
    } catch (error: any) {
      // Do not crash app startup if template model is missing in current Prisma client.
      console.warn(`⚠️ Template seeding skipped: ${error?.message || error}`);
    }
  }

  async seedTemplates() {
    console.log('🌱 Seeding templates...');
    try {
      // Clear existing default templates first
      const templateModel = this.getTemplateDelegate();
      await templateModel.deleteMany({
        where: { isDefault: true },
      });
      console.log('🗑️  Cleared existing default templates');
      
      // Seed new templates
      for (const template of templateSeeds) {
        await templateModel.create({
          data: template,
        });
      }
      console.log(`✅ Successfully seeded ${templateSeeds.length} templates with preview images`);
    } catch (error) {
      console.error('❌ Failed to seed templates:', error);
      throw error;
    }
  }

  async findAll(filter?: TemplateFilterDto) {
    const templateModel = this.getTemplateDelegate();
    const where: any = {};
    
    if (filter?.category) {
      where.category = filter.category;
    }
    
    if (filter?.isDefault !== undefined) {
      where.isDefault = filter.isDefault;
    }
    
    if (filter?.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return templateModel.findMany({
      where,
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findOne(id: string) {
    const templateModel = this.getTemplateDelegate();
    const template = await templateModel.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return template;
  }

  async create(data: CreateTemplateDto) {
    const templateModel = this.getTemplateDelegate();
    return templateModel.create({
      data: {
        ...data,
        isDefault: data.isDefault || false,
      },
    });
  }

  async update(id: string, data: Partial<CreateTemplateDto>) {
    await this.findOne(id); // Verify exists

    const templateModel = this.getTemplateDelegate();
    return templateModel.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findOne(id); // Verify exists

    const templateModel = this.getTemplateDelegate();
    return templateModel.delete({
      where: { id },
    });
  }

  async applyToPage(tenantId: string, pageId: string, templateId: string) {
    const template = await this.findOne(templateId);
    
    // Update the page with template content
    const updatedPage = await this.prisma.page.update({
      where: {
        id: pageId,
        tenantId,
      },
      data: {
        content: template.content,
      },
    });

    return updatedPage;
  }
}
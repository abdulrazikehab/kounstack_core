import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, TemplateFilterDto } from './dto/template.dto';
import { templateSeeds } from './seeds/template-seed';

@Injectable()
export class TemplateService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Always reseed templates if count doesn't match (added or removed templates)
    const count = await this.prisma.template.count({ where: { isDefault: true } });
    const expectedCount = templateSeeds.length;
    
    if (count !== expectedCount) {
      console.log(`🌱 Found ${count} templates but expected ${expectedCount}, reseeding...`);
      await this.seedTemplates();
    } else {
      console.log(`✅ Found ${count} default templates in database`);
    }
  }

  async seedTemplates() {
    console.log('🌱 Seeding templates...');
    try {
      // Clear existing default templates first
      await this.prisma.template.deleteMany({
        where: { isDefault: true },
      });
      console.log('🗑️  Cleared existing default templates');
      
      // Seed new templates
      for (const template of templateSeeds) {
        await this.prisma.template.create({
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

    return this.prisma.template.findMany({
      where,
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return template;
  }

  async create(data: CreateTemplateDto) {
    return this.prisma.template.create({
      data: {
        ...data,
        isDefault: data.isDefault || false,
      },
    });
  }

  async update(id: string, data: Partial<CreateTemplateDto>) {
    await this.findOne(id); // Verify exists
    
    return this.prisma.template.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findOne(id); // Verify exists
    
    return this.prisma.template.delete({
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
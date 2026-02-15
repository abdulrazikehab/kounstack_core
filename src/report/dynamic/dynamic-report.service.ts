import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';

@Injectable()
export class DynamicReportService {
  private readonly logger = new Logger(DynamicReportService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async generate(prompt: string, tenantId: string, userId: string) {
    const aiResult = await this.aiService.generateReportStructure(prompt);
    
    if (!aiResult.structure) {
      throw new Error(`AI failed to generate report structure: ${aiResult.description || 'Unknown error'}`);
    }

    // Create a pending report structure
    return this.prisma.dynamicReport.create({
      data: {
        tenantId,
        name: aiResult.name,
        description: aiResult.description,
        prompt,
        structure: aiResult.structure,
        status: 'PENDING',
        createdBy: userId,
      },
    });
  }

  async approve(id: string, tenantId: string) {
    const report = await this.prisma.dynamicReport.update({
      where: { id, tenantId },
      data: { status: 'APPROVED' },
    });

    // Notify/Copy to platform (Saa'ah/Koun) - In this architecture, it's already in the DB
    // Admins can see all dynamic reports with status APPROVED
    return report;
  }

  async list(tenantId: string) {
    return this.prisma.dynamicReport.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdminView() {
    // Platform Admin view to control/view all dynamic reports
    return this.prisma.dynamicReport.findMany({
      include: {
        tenant: {
          select: { name: true, subdomain: true }
        },
        creator: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async togglePlatformVerification(id: string, verified: boolean) {
    return this.prisma.dynamicReport.update({
      where: { id },
      data: { platformVerified: verified },
    });
  }
  
  async delete(id: string, tenantId: string) {
    return this.prisma.dynamicReport.delete({
      where: { id, tenantId },
    });
  }
}

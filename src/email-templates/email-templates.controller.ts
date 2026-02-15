import { Controller, Get, Post, Put, Body, UseGuards, Request, Logger, Param } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@UseGuards(JwtAuthGuard)
@Controller('email-templates')
export class EmailTemplatesController {
  private readonly logger = new Logger(EmailTemplatesController.name);

  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get(':templateType')
  async getTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('templateType') templateType: string,
  ) {
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.emailTemplatesService.getTemplate(tenantId, templateType);
  }

  @Post(':templateType')
  async createOrUpdateTemplate(
    @Request() req: AuthenticatedRequest,
    @Param('templateType') templateType: string,
    @Body() data: {
      subject: string;
      subjectAr?: string;
      body: string;
      bodyAr?: string;
      isActive?: boolean;
      templateType?: string;
    },
  ) {
    const tenantId = req.user.tenantId || req.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.emailTemplatesService.createOrUpdateTemplate(tenantId, templateType, data);
  }

  // Keep backward compatibility
  @Get('customer-problem')
  async getCustomerProblemTemplate(@Request() req: AuthenticatedRequest) {
    return this.getTemplate(req, 'customer-problem');
  }

  @Post('customer-problem')
  async createCustomerProblemTemplate(
    @Request() req: AuthenticatedRequest,
    @Body() data: {
      subject: string;
      subjectAr?: string;
      body: string;
      bodyAr?: string;
      isActive?: boolean;
    },
  ) {
    return this.createOrUpdateTemplate(req, 'customer-problem', data);
  }
}


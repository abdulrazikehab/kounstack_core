import { Controller, Post, Get, Body, Param, Put, Delete, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { DynamicReportService } from './dynamic-report.service';
import { AuthenticatedRequest } from '../../types/request.types';

@Controller('reports/dynamic')
@UseGuards(JwtAuthGuard)
export class DynamicReportController {
  constructor(private readonly dynamicReportService: DynamicReportService) {}

  @Post('generate')
  async generate(
    @Request() req: AuthenticatedRequest,
    @Body('prompt') prompt: string
  ) {
    return this.dynamicReportService.generate(prompt, req.tenantId, req.user.id);
  }

  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return this.dynamicReportService.list(req.tenantId);
  }

  @Put(':id/approve')
  async approve(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    return this.dynamicReportService.approve(id, req.tenantId);
  }

  @Delete(':id')
  async delete(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    return this.dynamicReportService.delete(id, req.tenantId);
  }

  // Admin Specific Endpoints
  @Get('admin/all')
  async getAdminAll(@Request() req: AuthenticatedRequest) {
    // Check if user is platform admin
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SYSTEM_ADMIN') {
      throw new Error('Unauthorized');
    }
    return this.dynamicReportService.getAdminView();
  }

  @Put('admin/:id/verify')
  async verify(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('verified') verified: boolean
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SYSTEM_ADMIN') {
      throw new Error('Unauthorized');
    }
    return this.dynamicReportService.togglePlatformVerification(id, verified);
  }
}

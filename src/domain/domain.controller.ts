import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DomainService } from './domain.service';
import { AuthenticatedRequest } from '../types/request.types';

@UseGuards(JwtAuthGuard)
@Controller('domains')
export class DomainController {
  constructor(private domainService: DomainService) {}

  @Post()
  async addDomain(
    @Request() req: AuthenticatedRequest,
    @Body() body: { domain: string },
  ) {
    if (!req.tenantId) {
      throw new BadRequestException('Please set up your tenant first');
    }
    return this.domainService.addCustomDomain(req.tenantId, body.domain);
  }

  @Post(':id/verify')
  async verifyDomain(
    @Request() req: AuthenticatedRequest,
    @Param('id') domainId: string,
  ) {
    if (!req.tenantId) {
      throw new BadRequestException('Please set up your tenant first');
    }
    return this.domainService.verifyDomain(req.tenantId, domainId);
  }

  @Get()
  async getDomains(@Request() req: AuthenticatedRequest) {
    // Return empty array if user hasn't set up their tenant yet
    if (!req.tenantId) {
      return [];
    }
    return this.domainService.getTenantDomains(req.tenantId);
  }

  @Delete(':id')
  async removeDomain(
    @Request() req: AuthenticatedRequest,
    @Param('id') domainId: string,
  ) {
    if (!req.tenantId) {
      throw new BadRequestException('Please set up your tenant first');
    }
    return this.domainService.removeDomain(req.tenantId, domainId);
  }
}
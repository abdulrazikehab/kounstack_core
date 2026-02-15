
import { Controller, Get, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('tree')
  async getTree(@Request() req) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant context required');
    return this.catalogService.getTree(tenantId);
  }
}

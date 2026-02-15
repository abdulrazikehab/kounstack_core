import { Controller, Get, Param, Res } from '@nestjs/common';
import { SeoService } from './seo.service';
import { Response } from 'express';

@Controller('seo')
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Get('sitemap/:tenantId')
  async getSitemap(@Param('tenantId') tenantId: string, @Res() res: Response) {
    const filePath = await this.seoService.generateSitemap(tenantId);
    res.sendFile(filePath, { root: '.' });
  }

  @Get('robots/:tenantId')
  async getRobots(@Param('tenantId') tenantId: string, @Res() res: Response) {
    const filePath = await this.seoService.generateRobots(tenantId);
    res.sendFile(filePath, { root: '.' });
  }
}

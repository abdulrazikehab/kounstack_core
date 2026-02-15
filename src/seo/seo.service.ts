import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SeoService {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /** Generate sitemap.xml for a given tenant */
  async generateSitemap(tenantId: string): Promise<string> {
    // SECURITY FIX: Validate tenantId to prevent path traversal
    if (!tenantId || !/^[a-zA-Z0-9-]+$/.test(tenantId) || tenantId.includes('..')) {
      throw new BadRequestException('Invalid tenant ID');
    }
    const host = this.configService.get<string>('BASE_URL');
    const baseUrl = `${host}/${tenantId}`;

    // Static routes
    const urls = [
      { loc: baseUrl, changefreq: 'daily', priority: '1.0' },
      { loc: `${baseUrl}/products`, changefreq: 'daily', priority: '0.8' },
      { loc: `${baseUrl}/categories`, changefreq: 'weekly', priority: '0.8' },
    ];

    // Fetch dynamic routes
    const products = await this.prisma.product.findMany({
      where: { tenantId, isPublished: true },
      select: { id: true, updatedAt: true }, // In real app, use slug
    });

    const categories = await this.prisma.category.findMany({
      where: { tenantId, isActive: true },
      select: { slug: true, updatedAt: true },
    });

    const pages = await this.prisma.page.findMany({
      where: { tenantId, isPublished: true },
      select: { slug: true, updatedAt: true },
    });

    // Add products
    for (const product of products) {
      urls.push({
        loc: `${baseUrl}/products/${product.id}`, // Should be slug
        changefreq: 'weekly',
        priority: '0.7',
      });
    }

    // Add categories
    for (const category of categories) {
      urls.push({
        loc: `${baseUrl}/collections/${category.slug}`,
        changefreq: 'weekly',
        priority: '0.7',
      });
    }

    // Add pages
    for (const page of pages) {
      urls.push({
        loc: `${baseUrl}/${page.slug}`,
        changefreq: 'monthly',
        priority: '0.5',
      });
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${url.loc}</loc>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    const dir = path.join('public', tenantId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'sitemap.xml');
    fs.writeFileSync(filePath, sitemap);
    return filePath;
  }

  /** Generate robots.txt for a given tenant */
  async generateRobots(tenantId: string): Promise<string> {
    // SECURITY FIX: Validate tenantId to prevent path traversal
    if (!tenantId || !/^[a-zA-Z0-9-]+$/.test(tenantId) || tenantId.includes('..')) {
      throw new BadRequestException('Invalid tenant ID');
    }
    const host = this.configService.get<string>('BASE_URL');
    const content = `User-agent: *
Allow: /
Disallow: /checkout
Disallow: /account
Sitemap: ${host}/${tenantId}/sitemap.xml`;

    const dir = path.join('public', tenantId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'robots.txt');
    fs.writeFileSync(filePath, content);
    return filePath;
  }
}

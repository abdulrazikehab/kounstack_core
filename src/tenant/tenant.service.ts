import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        subdomain: true,
        plan: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const subscriptionPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { code: tenant.plan },
    });

    return { ...tenant, subscriptionPlan };
  }

  async getAllTenants() {
    return this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        subdomain: true,
        plan: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async searchTenants(query: string) {
    if (!query) return [];
    
    return this.prisma.tenant.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { subdomain: { contains: query, mode: 'insensitive' } },
        ],
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        subdomain: true,
        settings: true, // Include settings for store description/logo if needed
      },
      take: 20,
    });
  }

  async updateTenant(id: string, data: { name?: string; nameAr?: string; description?: string; descriptionAr?: string; subdomain?: string; plan?: string; status?: string }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return this.prisma.tenant.update({
      where: { id },
      data,
    });
  }

  async checkSubdomainAvailability(subdomain: string, excludeTenantId?: string): Promise<boolean> {
    // Check if subdomain already exists
    // Only select fields that exist in the database to avoid schema mismatch errors
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain },
      select: {
        id: true,
        subdomain: true,
        // Only select fields that definitely exist in the database
      },
    });
    
    if (tenant) {
      // If excludeTenantId is provided and matches, consider it available (for updates)
      if (excludeTenantId && tenant.id === excludeTenantId) {
        // Continue to check for custom domain conflicts
      } else {
        return false; // Subdomain is taken by another tenant
      }
    }
    
    // Check if subdomain conflicts with existing custom domain
    // e.g., if subdomain "asus" conflicts with custom domain "asus.kawn.com"
    const potentialCustomDomains = [
      `${subdomain}.kawn.com`,
      `${subdomain}.kawn.net`
    ];
    
    const existingCustomDomain = await this.prisma.customDomain.findFirst({
      where: {
        domain: { in: potentialCustomDomains },
        status: { in: ['ACTIVE', 'PENDING'] } // Check both active and pending
      }
    });
    
    if (existingCustomDomain) {
      // If excludeTenantId matches, allow (same tenant updating)
      if (excludeTenantId && existingCustomDomain.tenantId === excludeTenantId) {
        return true;
      }
      return false; // Custom domain conflict
    }
    
    return true; // Subdomain is available
  }

  async resolveTenantId(domain: string): Promise<string | null> {
    // Normalize domain (remove protocol, port, trailing slashes)
    const normalizedDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0];
    
    // 1. First check if it's a custom domain (including koun.com as main domain)
    const customDomain = await this.prisma.customDomain.findFirst({
      where: { 
        domain: normalizedDomain,
        status: 'ACTIVE'
      },
      select: { tenantId: true },
    });

    if (customDomain) return customDomain.tenantId;

    // 2. Check if it's the main domain - should be handled as custom domain, but fallback
    const platformDomain = this.configService.get<string>('PLATFORM_DOMAIN') || 'saeaa.com';
    const secondaryDomain = this.configService.get<string>('PLATFORM_SECONDARY_DOMAIN') || 'saeaa.net';

    const mainDomains = [
      platformDomain,
      `www.${platformDomain}`,
      `app.${platformDomain}`,
      secondaryDomain,
      `www.${secondaryDomain}`,
      `app.${secondaryDomain}`,
      'kawn.com',
      'www.kawn.com',
      'kawn.net',
      'www.kawn.net',
      'app.kawn.com',
      'app.kawn.net'
    ];
    if (mainDomains.includes(normalizedDomain)) {
      // Try to find default tenant or first tenant
      const defaultTenant = await this.prisma.tenant.findFirst({
        where: { id: 'default' },
        select: { id: true },
      });
      if (defaultTenant) return defaultTenant.id;
    }

    // 3. Check if it's a subdomain of localhost or the main domain
    let subdomain = '';
    
    if (normalizedDomain.endsWith('.localhost')) {
      subdomain = normalizedDomain.replace('.localhost', '');
    } else if (normalizedDomain.endsWith(`.${platformDomain}`)) {
      subdomain = normalizedDomain.replace(`.${platformDomain}`, '');
    } else if (normalizedDomain.endsWith(`.${secondaryDomain}`)) {
      subdomain = normalizedDomain.replace(`.${secondaryDomain}`, '');
    } else if (normalizedDomain.endsWith('.kawn.com')) {
      subdomain = normalizedDomain.replace('.kawn.com', '');
      // Don't treat www or app as a subdomain
      if (subdomain === 'www' || subdomain === 'app') {
        return null;
      }
    } else if (normalizedDomain.endsWith('.kawn.net')) {
      subdomain = normalizedDomain.replace('.kawn.net', '');
      // Don't treat www or app as a subdomain
      if (subdomain === 'www' || subdomain === 'app') {
        return null;
      }
    } else if (normalizedDomain === 'localhost' || normalizedDomain === '127.0.0.1') {
      return null; // Main domain, no tenant
    }

    if (subdomain) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { subdomain },
        select: { id: true },
      });
      if (tenant) return tenant.id;
    }

    return null;
  }

  async getTenantIdByUserId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    return user?.tenantId || null;
  }

  async suggestSubdomains(baseSubdomain: string, limit: number = 3): Promise<string[]> {
    const suggestions: string[] = [];
    const suffixes = ['store', 'shop', 'market', 'boutique', 'official'];
    
    // Try adding numbers
    let attempts = 0;
    while (suggestions.length < limit && attempts < 20) {
      const randomNum = Math.floor(Math.random() * 1000);
      const candidate = `${baseSubdomain}${randomNum}`;
      if (await this.checkSubdomainAvailability(candidate)) {
        suggestions.push(candidate);
      }
      attempts++;
    }

    // Try adding suffixes if we still need more
    if (suggestions.length < limit) {
      for (const suffix of suffixes) {
        if (suggestions.length >= limit) break;
        const candidate = `${baseSubdomain}-${suffix}`;
        if (await this.checkSubdomainAvailability(candidate)) {
           // Avoid duplicates (unlikely but good practice)
           if (!suggestions.includes(candidate)) {
             suggestions.push(candidate);
           }
        }
      }
    }
    
    return suggestions;
  }
}
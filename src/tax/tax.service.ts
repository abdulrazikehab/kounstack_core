import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface TaxCalculationResult {
  originalAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxRate: number;
  country?: string;
  state?: string;
  taxRateId?: string;
}

@Injectable()
export class TaxService {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService
  ) {}

  /**
   * Calculate tax for an order based on tenant's tax rates
   */
  async calculateTax(
    tenantId: string, 
    amount: number, 
    country?: string, 
    state?: string
  ): Promise<TaxCalculationResult> {
    // Verify tenant exists and check if tax is enabled
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, settings: true }
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    // Check if tax is enabled in tenant settings
    const tenantSettings = (tenant.settings || {}) as any;
    const taxEnabled = tenantSettings.taxEnabled !== false; // Default to true if not set

    // If tax is disabled, return zero tax
    if (!taxEnabled) {
      return {
        originalAmount: Number(amount),
        taxAmount: 0,
        totalAmount: Number(amount),
        taxRate: 0,
        country: country || undefined,
        state: state || undefined,
        taxRateId: undefined
      };
    }

    // Get applicable tax rate
    const taxRate = await this.getApplicableTaxRate(tenantId, country, state);
    
    const taxAmount = Number(amount) * Number(taxRate.rate);
    const totalAmount = Number(amount) + taxAmount;

    return {
      originalAmount: Number(amount),
      taxAmount,
      totalAmount,
      taxRate: Number(taxRate.rate),
      country: taxRate.country,
      state: taxRate.state || undefined,
      taxRateId: taxRate.id
    };
  }

  /**
   * Get applicable tax rate for a location
   */
  private async getApplicableTaxRate(tenantId: string, country?: string, state?: string) {
    // If country and state are provided, try to find specific rate
    if (country) {
      const specificRate = await this.prisma.taxRate.findFirst({
        where: {
          tenantId,
          country,
          state: state || null,
          isActive: true
        }
      });

      if (specificRate) {
        return specificRate;
      }

      // Fallback to country-level rate
      const countryRate = await this.prisma.taxRate.findFirst({
        where: {
          tenantId,
          country,
          state: null,
          isActive: true
        }
      });

      if (countryRate) {
        return countryRate;
      }
    }

    // Fallback to default tax rate from tenant settings or config
    const defaultRate = await this.getDefaultTaxRate(tenantId);
    return {
      id: 'default',
      rate: defaultRate,
      country: country || 'default',
      state: state || null
    };
  }

  /**
   * Get default tax rate for tenant
   */
  private async getDefaultTaxRate(tenantId: string): Promise<number> {
    // Try to get from tenant settings first
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    });

    if (tenant?.settings) {
      const settings = tenant.settings as any;
      if (settings.defaultTaxRate !== undefined) {
        return Number(settings.defaultTaxRate);
      }
    }

    // Fallback to environment config
    return this.configService.get<number>('DEFAULT_TAX_RATE') || 0.15;
  }

  /**
   * Get all tax rates for a tenant
   */
  async getTaxRates(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true }
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    const rates = await this.prisma.taxRate.findMany({
      where: { tenantId },
      orderBy: [{ country: 'asc' }, { state: 'asc' }]
    });

    return rates.map((rate: { rate: any; }) => ({
      ...rate,
      rate: Number(rate.rate)
    }));
  }

  /**
   * Get tax rate for a specific location
   */
  async getTaxRateForLocation(tenantId: string, country: string, state?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true }
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    const rate = await this.prisma.taxRate.findFirst({
      where: {
        tenantId,
        country,
        state: state || null,
        isActive: true
      }
    });

    if (!rate) {
      throw new NotFoundException(
        `Tax rate not found for country: ${country}, state: ${state || 'any'}`
      );
    }

    return {
      ...rate,
      rate: Number(rate.rate)
    };
  }

  /**
   * Create or update tax rate for a tenant
   */
  async upsertTaxRate(
    tenantId: string, 
    country: string, 
    rate: number, 
    state?: string, 
    isActive: boolean = true
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true }
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    return this.prisma.taxRate.upsert({
      where: {
        tenantId_country_state: {
          tenantId,
          country,
          state: state || null
        }
      },
      update: {
        rate,
        isActive
      },
      create: {
        tenantId,
        country,
        state: state || null,
        rate,
        isActive
      }
    });
  }
}
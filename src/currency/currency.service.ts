// apps/app-core/src/currency/currency.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCurrencyDto {
  code: string;
  name: string;
  nameAr?: string;
  symbol: string;
  symbolAr?: string;
  exchangeRate: number;
  precision?: number; // Decimal places (default: 2)
  isDefault?: boolean;
  sortOrder?: number;
  icon?: string; // Currency icon/logo URL
}

export interface UpdateCurrencyDto {
  name?: string;
  nameAr?: string;
  symbol?: string;
  symbolAr?: string;
  exchangeRate?: number;
  precision?: number;
  isActive?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  icon?: string; // Currency icon/logo URL
}

export interface UpdateCurrencySettingsDto {
  baseCurrency: string;
  autoUpdateRates?: boolean;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, data: CreateCurrencyDto) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check if currency code already exists for this tenant
    const existing = await this.prisma.currency.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: data.code,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(`Currency ${data.code} already exists`);
    }

    // If this currency is set as default, unset other defaults first
    if (data.isDefault) {
      await this.prisma.currency.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const currency = await this.prisma.currency.create({
      data: {
        tenantId,
        code: data.code.toUpperCase(),
        name: data.name,
        nameAr: data.nameAr,
        symbol: data.symbol,
        symbolAr: data.symbolAr,
        icon: data.icon,
        exchangeRate: data.exchangeRate,
        precision: data.precision ?? 2,
        isDefault: data.isDefault ?? false,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    this.logger.log(`Currency created: ${currency.code} for tenant ${tenantId}`);
    return currency;
  }

  // Format amount according to currency precision
  formatAmount(amount: number, precision: number = 2): string {
    return amount.toFixed(precision);
  }

  // Round amount according to currency precision
  roundAmount(amount: number, precision: number = 2): number {
    const multiplier = Math.pow(10, precision);
    return Math.round(amount * multiplier) / multiplier;
  }

  // Get default currency for tenant
  async getDefaultCurrency(tenantId: string) {
    const currency = await this.prisma.currency.findFirst({
      where: { tenantId, isDefault: true, isActive: true },
    });

    if (!currency) {
      // Fallback to SAR or first active currency
      return this.prisma.currency.findFirst({
        where: { 
          tenantId, 
          isActive: true,
          OR: [{ code: 'SAR' }, {}],
        },
        orderBy: [{ code: 'asc' }],
      });
    }

    return currency;
  }

  async findAll(tenantId: string, includeInactive: boolean = false) {
    const where: any = { tenantId };
    if (!includeInactive) {
      where.isActive = true;
    }

    // First, verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      this.logger.warn(`Tenant ${tenantId} does not exist. Returning empty array.`);
      return [];
    }

    const currencies = await this.prisma.currency.findMany({
      where,
      orderBy: { code: 'asc' },
    });

    // If no currencies exist, initialize default ones
    if (currencies.length === 0) {
      this.logger.warn(`No currencies found for tenant ${tenantId}, initializing defaults...`);
      try {
        await this.initializeDefaultCurrencies(tenantId);
        
        // Fetch again after initialization
        return this.prisma.currency.findMany({
          where,
          orderBy: { code: 'asc' },
        });
      } catch (error: any) {
        this.logger.error(`Failed to initialize currencies for tenant ${tenantId}:`, error);
        // Return empty array instead of throwing
        return [];
      }
    }

    return currencies;
  }

  async findOne(tenantId: string, code: string) {
    const currency = await this.prisma.currency.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: code.toUpperCase(),
        },
      },
    });

    if (!currency) {
      throw new NotFoundException(`Currency ${code} not found`);
    }

    return currency;
  }

  async update(tenantId: string, code: string, data: UpdateCurrencyDto) {
    await this.findOne(tenantId, code);

    // If this currency is being set as default, unset other defaults first
    if (data.isDefault) {
      await this.prisma.currency.updateMany({
        where: { tenantId, isDefault: true, NOT: { code: code.toUpperCase() } },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.currency.update({
      where: {
        tenantId_code: {
          tenantId,
          code: code.toUpperCase(),
        },
      },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        symbol: data.symbol,
        symbolAr: data.symbolAr,
        icon: data.icon,
        exchangeRate: data.exchangeRate,
        precision: data.precision,
        isActive: data.isActive,
        isDefault: data.isDefault,
        sortOrder: data.sortOrder,
      },
    });

    this.logger.log(`Currency updated: ${code}`);
    return updated;
  }

  // Set a currency as default
  async setDefault(tenantId: string, code: string) {
    await this.findOne(tenantId, code);

    // Unset all other defaults
    await this.prisma.currency.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });

    // Set this one as default
    const updated = await this.prisma.currency.update({
      where: {
        tenantId_code: {
          tenantId,
          code: code.toUpperCase(),
        },
      },
      data: { isDefault: true },
    });

    // Also update currency settings
    await this.prisma.currencySettings.upsert({
      where: { tenantId },
      update: { baseCurrency: code.toUpperCase() },
      create: { tenantId, baseCurrency: code.toUpperCase() },
    });

    this.logger.log(`Currency ${code} set as default for tenant ${tenantId}`);
    return updated;
  }

  async remove(tenantId: string, code: string) {
    await this.findOne(tenantId, code);

    // Check if it's the base currency
    const settings = await this.getSettings(tenantId);
    if (settings?.baseCurrency === code.toUpperCase()) {
      throw new BadRequestException('Cannot delete base currency');
    }

    await this.prisma.currency.delete({
      where: {
        tenantId_code: {
          tenantId,
          code: code.toUpperCase(),
        },
      },
    });

    this.logger.log(`Currency deleted: ${code}`);
  }

  async getSettings(tenantId: string) {
    return this.prisma.currencySettings.findUnique({
      where: { tenantId },
    });
  }

  async updateSettings(tenantId: string, data: UpdateCurrencySettingsDto) {
    // Get current settings to check if base currency is changing
    const currentSettings = await this.getSettings(tenantId);
    const oldBaseCurrency = currentSettings?.baseCurrency;
    const newBaseCurrency = data.baseCurrency.toUpperCase();
    
    // Verify new base currency exists
    const newBaseCurrencyData = await this.findOne(tenantId, newBaseCurrency);
    
    // Get old base currency data if it's changing
    let oldBaseCurrencyData = null;
    if (oldBaseCurrency && oldBaseCurrency !== newBaseCurrency) {
      try {
        oldBaseCurrencyData = await this.findOne(tenantId, oldBaseCurrency);
      } catch (error) {
        this.logger.warn(`Old base currency ${oldBaseCurrency} not found, skipping rate recalculation`);
      }
    }

    // Update settings
    const settings = await this.prisma.currencySettings.upsert({
      where: { tenantId },
      update: {
        baseCurrency: newBaseCurrency,
        autoUpdateRates: data.autoUpdateRates ?? false,
        lastUpdated: new Date(),
      },
      create: {
        tenantId,
        baseCurrency: newBaseCurrency,
        autoUpdateRates: data.autoUpdateRates ?? false,
      },
    });

    // If base currency changed, recalculate all exchange rates
    if (oldBaseCurrency && oldBaseCurrency !== newBaseCurrency && oldBaseCurrencyData) {
      this.logger.log(`Base currency changed from ${oldBaseCurrency} to ${newBaseCurrency}, recalculating exchange rates...`);
      
      // Get the old base currency's exchange rate (should be 1, but get it to be safe)
      const oldBaseRate = Number(oldBaseCurrencyData.exchangeRate) || 1;
      
      // Get the new base currency's current exchange rate relative to old base
      const newBaseRate = Number(newBaseCurrencyData.exchangeRate) || 1;
      
      // Calculate conversion factor: newRate = oldRate / newBaseRate
      // Example: If SAR (1.0) is base and USD is 0.2667, and we switch to USD:
      //   USD becomes 1.0 (new base)
      //   SAR becomes 1.0 / 0.2667 = 3.75
      const conversionFactor = oldBaseRate / newBaseRate;
      
      // Get all currencies for this tenant
      const allCurrencies = await this.prisma.currency.findMany({
        where: { tenantId, isActive: true },
      });
      
      // Recalculate all exchange rates
      const updatePromises = allCurrencies.map(async (currency) => {
        if (currency.code === newBaseCurrency) {
          // New base currency always has rate of 1
          return this.prisma.currency.update({
            where: {
              tenantId_code: {
                tenantId,
                code: currency.code,
              },
            },
            data: { exchangeRate: 1 },
          });
        } else {
          // Recalculate: newRate = oldRate / newBaseRate
          const oldRate = Number(currency.exchangeRate) || 1;
          const newRate = oldRate * conversionFactor;
          
          this.logger.log(`Recalculating ${currency.code}: ${oldRate} -> ${newRate} (factor: ${conversionFactor})`);
          
          return this.prisma.currency.update({
            where: {
              tenantId_code: {
                tenantId,
                code: currency.code,
              },
            },
            data: { exchangeRate: newRate },
          });
        }
      });
      
      await Promise.all(updatePromises);
      this.logger.log(`Exchange rates recalculated for ${allCurrencies.length} currencies`);
    } else {
      // Just update new base currency to 1 if it's not already
      await this.prisma.currency.update({
        where: {
          tenantId_code: {
            tenantId,
            code: newBaseCurrencyData.code,
          },
        },
        data: { exchangeRate: 1 },
      });
    }

    // Sync currency to tenant.settings.currency (so Settings page shows the same currency)
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const currentTenantSettings = (tenant?.settings || {}) as Record<string, unknown>;
    const updatedTenantSettings = {
      ...currentTenantSettings,
      currency: newBaseCurrency,
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: updatedTenantSettings },
    });

    this.logger.log(`Currency settings updated for tenant ${tenantId}`);
    return settings;
  }

  async updateExchangeRates(tenantId: string, rates: Record<string, number>) {
    const settings = await this.getSettings(tenantId);
    if (!settings) {
      throw new BadRequestException('Currency settings not configured');
    }

    const updates = Object.entries(rates).map(([code, rate]) =>
      this.prisma.currency.update({
        where: {
          tenantId_code: {
            tenantId,
            code: code.toUpperCase(),
          },
        },
        data: { exchangeRate: rate },
      })
    );

    await Promise.all(updates);

    await this.prisma.currencySettings.update({
      where: { tenantId },
      data: { lastUpdated: new Date() },
    });

    this.logger.log(`Exchange rates updated for tenant ${tenantId}`);
  }

  /**
   * Initialize default currencies for a new tenant
   * Creates SAR (as base), USD, AED, KWD, and QAR with default exchange rates
   */
  async initializeDefaultCurrencies(tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    this.logger.log(`Initializing default currencies for tenant ${tenantId}`);

    // Verify tenant exists before creating currencies
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new BadRequestException(`Tenant ${tenantId} does not exist. Cannot initialize currencies.`);
    }

    // Default currencies: SAR (base), USD, AED, KWD, QAR
    const defaultCurrencies = [
      {
        tenantId,
        code: 'SAR',
        name: 'Saudi Riyal',
        nameAr: 'ريال سعودي',
        symbol: 'ر.س',
        symbolAr: 'ر.س',
        icon: '/assets/currencies/sar.svg',
        exchangeRate: 1, // Base currency - always 1
        precision: 2,
        isActive: true,
        isDefault: true,
        sortOrder: 1,
      },
      {
        tenantId,
        code: 'USD',
        name: 'US Dollar',
        nameAr: 'دولار أمريكي',
        symbol: '$',
        symbolAr: '$',
        icon: null,
        exchangeRate: 0.2667, // 1 SAR = 0.2667 USD (approximately 1 USD = 3.75 SAR)
        precision: 4,
        isActive: true,
        isDefault: false,
        sortOrder: 2,
      },
      {
        tenantId,
        code: 'AED',
        name: 'UAE Dirham',
        nameAr: 'درهم إماراتي',
        symbol: 'د.إ',
        symbolAr: 'د.إ',
        icon: null,
        exchangeRate: 0.98, // 1 SAR ≈ 0.98 AED
        precision: 2,
        isActive: true,
        isDefault: false,
        sortOrder: 3,
      },
      {
        tenantId,
        code: 'KWD',
        name: 'Kuwaiti Dinar',
        nameAr: 'دينار كويتي',
        symbol: 'د.ك',
        symbolAr: 'د.ك',
        icon: null,
        exchangeRate: 0.082, // 1 SAR ≈ 0.082 KWD
        precision: 3,
        isActive: true,
        isDefault: false,
        sortOrder: 4,
      },
      {
        tenantId,
        code: 'QAR',
        name: 'Qatari Riyal',
        nameAr: 'ريال قطري',
        symbol: 'ر.ق',
        symbolAr: 'ر.ق',
        icon: null,
        exchangeRate: 0.97, // 1 SAR ≈ 0.97 QAR
        precision: 2,
        isActive: true,
        isDefault: false,
        sortOrder: 5,
      },
    ];

    // Upsert currencies (create or update)
    for (const currencyData of defaultCurrencies) {
      const { code, ...data } = currencyData;
      await this.prisma.currency.upsert({
        where: {
          tenantId_code: {
            tenantId,
            code,
          },
        },
        update: {
          name: data.name,
          nameAr: data.nameAr,
          symbol: data.symbol,
          symbolAr: data.symbolAr,
          icon: data.icon,
          exchangeRate: data.exchangeRate,
          precision: data.precision,
          isActive: data.isActive,
          isDefault: data.isDefault,
          sortOrder: data.sortOrder,
        },
        create: currencyData,
      });
      this.logger.log(`Upserted default currency: ${code} for tenant ${tenantId}`);
    }

    // Create currency settings with SAR as base
    await this.prisma.currencySettings.upsert({
      where: { tenantId },
      update: { baseCurrency: 'SAR' },
      create: {
        tenantId,
        baseCurrency: 'SAR',
        autoUpdateRates: false,
      },
    });

    this.logger.log(`Initialized default currencies for tenant ${tenantId}`);
  }
}


import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PageService } from '../page/page.service';
import { PaymentSettingsService } from '../payment/payment-settings.service';
import { AuthClientService } from '../tenant/auth-client.service';
import { TenantSyncService } from '../tenant/tenant-sync.service';

/**
 * Service to manage per‑tenant site configuration such as header links,
 * background style, language, and enabled payment methods.
 */
@Injectable()
export class SiteConfigService {
  private readonly logger = new Logger(SiteConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pageService: PageService,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly authClientService: AuthClientService,
    private readonly tenantSyncService: TenantSyncService
  ) {}

  /** Get configuration for a tenant */
  async getConfig(tenantId: string | null | undefined, themeId?: string) {
    if (!tenantId || tenantId === 'default') {
      // Return default config if no tenantId
      const defaultSettings = {
        storeName: '',
        storeNameAr: '',
        storeDescription: '',
        storeDescriptionAr: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        country: 'SA',
        postalCode: '',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        language: 'ar',
        taxEnabled: true,
        taxRate: 15,
        shippingEnabled: true,
        inventoryTracking: true,
        lowStockThreshold: 10,
        allowGuestCheckout: true,
        requireEmailVerification: false,
        maintenanceMode: false,
        storeLogoUrl: '',
        googlePlayUrl: '',
        appStoreUrl: '',
        blockVpnUsers: false,
        storeType: 'GENERAL',
        businessModel: 'B2C',
        customerRegistrationRequestEnabled: false,
      };
      
      return {
        tenantId: tenantId || 'default',
        header: { title: 'Store', links: [] },
        footer: { links: [] },
        background: { type: 'color', value: '#ffffff' },
        language: 'ar',
        theme: 'light',
        paymentMethods: [],
        hyperpayConfig: {
          entityId: '',
          accessToken: '',
          testMode: true,
          currency: 'SAR',
        },
        settings: defaultSettings,
      };
    }

    const cfg = await this.prisma.siteConfig.findUnique({
      where: { tenantId },
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { 
        settings: true,
        subdomain: true,
        name: true,
        nameAr: true,
        description: true,
        descriptionAr: true,
        storeType: true,
        isPrivateStore: true,
        customerRegistrationRequestEnabled: true,
      }
    });

    const tenantSettings = (tenant?.settings || {}) as Record<string, unknown>;
    
    // Fetch currency settings (source of truth for base currency)
    const currencySettings = await this.prisma.currencySettings.findUnique({
      where: { tenantId },
    });
    
    // Determine currency: CurrencySettings.baseCurrency > tenant.settings.currency > 'SAR'
    const baseCurrency = currencySettings?.baseCurrency 
      || (tenantSettings.currency as string)?.toUpperCase()
      || 'SAR';
    
    // If previewing a theme, fetch its draft settings
    let previewThemeSettings = {};
    if (themeId) {
      const theme = await this.prisma.theme.findFirst({
        where: { id: themeId, tenantId },
      });
      if (theme) {
        // Use draftSettings if available, otherwise settings
        previewThemeSettings = theme.draftSettings || theme.settings || {};
      }
    }

    // Fetch payment settings from PaymentSettingsService (source of truth)
    const paymentSettings = await this.paymentSettingsService.getSettings(tenantId);
    
    // Map PaymentSettings to frontend format
    const paymentMethods: string[] = [];
    if (paymentSettings.hyperPayEnabled) paymentMethods.push('HYPERPAY');
    if (paymentSettings.stripeEnabled) paymentMethods.push('STRIPE');
    if (paymentSettings.payPalEnabled) paymentMethods.push('PAYPAL');
    if (paymentSettings.codEnabled) paymentMethods.push('CASH_ON_DELIVERY');

    const hyperpayConfig = {
      entityId: paymentSettings.hyperPayEntityId || '',
      accessToken: paymentSettings.hyperPayAccessToken || '',
      testMode: paymentSettings.hyperPayTestMode,
      currency: paymentSettings.hyperPayCurrency,
    };

    // Merge all settings into a unified settings object for the frontend
    const defaultSettings = {
      storeName: tenant?.name || '',
      storeNameAr: tenant?.nameAr || '',
      storeDescription: tenant?.description || '',
      storeDescriptionAr: tenant?.descriptionAr || '',
      email: '',
      phone: '',
      address: '',
      city: '',
      country: 'SA',
      postalCode: '',
      currency: baseCurrency,
      timezone: 'Asia/Riyadh',
      language: 'ar',
      taxEnabled: tenantSettings.taxEnabled !== undefined ? tenantSettings.taxEnabled : true,
      taxRate: tenantSettings.taxRate !== undefined ? tenantSettings.taxRate : 15,
      shippingEnabled: tenantSettings.shippingEnabled !== undefined ? tenantSettings.shippingEnabled : true,
      inventoryTracking: tenantSettings.inventoryTracking !== undefined ? tenantSettings.inventoryTracking : true,
      lowStockThreshold: tenantSettings.lowStockThreshold !== undefined ? tenantSettings.lowStockThreshold : 10,
      allowGuestCheckout: tenantSettings.allowGuestCheckout !== undefined ? tenantSettings.allowGuestCheckout : true,
      requireEmailVerification: tenantSettings.requireEmailVerification !== undefined ? tenantSettings.requireEmailVerification : false,
      maintenanceMode: tenantSettings.maintenanceMode !== undefined ? tenantSettings.maintenanceMode : false,
      storeLogoUrl: '',
      googlePlayUrl: '',
      appStoreUrl: '',
      blockVpnUsers: false,
      storeType: tenant?.storeType || 'GENERAL',
      isPrivateStore: (tenant as any)?.isPrivateStore || false,
      businessModel: (tenantSettings.businessModel as 'B2B' | 'B2C') || 'B2C',
      customerRegistrationRequestEnabled: (tenant as any)?.customerRegistrationRequestEnabled || false,
    };

    if (!cfg) {
      // Return sensible defaults if none exist yet
      return {
        tenantId,
        header: { title: tenant?.name || 'Store', links: [] },
        footer: { links: [] },
        background: { type: 'color', value: '#ffffff' },
        language: 'ar',
        theme: 'light',
        paymentMethods,
        hyperpayConfig,
        settings: {
          ...defaultSettings,
          ...tenantSettings,
          ...previewThemeSettings,
          currency: baseCurrency, // Ensure CurrencySettings.baseCurrency takes precedence
          paymentMethods,
          hyperpayConfig,
          subdomain: tenant?.subdomain,
          tenantName: tenant?.name
        },
      };
    }
    
    // Merge SiteConfig payment fields into settings for frontend access
    return {
      ...cfg,
      paymentMethods, // Override with data from PaymentSettingsService
      hyperpayConfig, // Override with data from PaymentSettingsService
      settings: {
        ...defaultSettings,
        ...tenantSettings,
        ...previewThemeSettings,
        currency: baseCurrency, // Ensure CurrencySettings.baseCurrency takes precedence
        // Include payment config from PaymentSettingsService in settings
        paymentMethods,
        hyperpayConfig,
        subdomain: tenant?.subdomain,
        tenantName: tenant?.name
      },
    };
  }

  /** Update (or create) configuration for a tenant */
  async upsertConfig(tenantId: string, data: any, accessToken?: string) {
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      this.logger.error('upsertConfig called with invalid tenantId:', tenantId);
      throw new BadRequestException('Valid tenant ID is required to update configuration');
    }

    // Validate data structure
    if (!data || typeof data !== 'object') {
      this.logger.error('Invalid data structure provided to upsertConfig:', typeof data);
      throw new BadRequestException('Invalid configuration data. Expected an object.');
    }

    try {
      // Check if tenant exists first
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });

      if (!existingTenant) {
        // Try to fetch tenant info from auth service and create in core
        this.logger.warn(`⚠️ Tenant ${tenantId} does not exist in core database, attempting to fetch from auth service...`);
        
        if (accessToken) {
          try {
            // Try to get tenant info from auth service
            // The getUserMarkets endpoint returns markets for the authenticated user based on the token
            // We pass empty string for userId since the endpoint uses the token to identify the user
            const markets = await this.authClientService.getUserMarkets('', accessToken);
            const authTenant = markets.find((m: any) => m.id === tenantId);
            
            if (authTenant) {
              // Tenant exists in auth, create it in core with subdomain
              this.logger.log(`🔄 Tenant ${tenantId} exists in auth service, creating in core with subdomain: ${authTenant.subdomain}`);
              const tenant = await this.tenantSyncService.ensureTenantExists(tenantId, {
                name: authTenant.name,
                subdomain: authTenant.subdomain,
                description: authTenant.description,
              });
              
              if (tenant) {
                this.logger.log(`✅ Tenant ${tenantId} auto-created from auth service`);
              } else {
                throw new BadRequestException(`Tenant ${tenantId} exists in auth but could not be created in core database.`);
              }
            } else {
              // Tenant not found in auth service either
              this.logger.error(`Tenant ${tenantId} does not exist in core or auth database`);
              throw new BadRequestException(`Tenant ${tenantId} does not exist. Please set up your market first.`);
            }
          } catch (authError: any) {
            this.logger.warn(`⚠️ Could not fetch tenant from auth service: ${authError.message}`);
            // Fallback: try to ensure tenant exists (will fail if no subdomain)
            const tenant = await this.tenantSyncService.ensureTenantExists(tenantId);
            if (!tenant) {
              this.logger.error(`Tenant ${tenantId} does not exist and could not be created`);
              throw new BadRequestException(`Tenant ${tenantId} does not exist. Please set up your market first.`);
            }
          }
        } else {
          // No access token, try to ensure tenant exists (will fail if no subdomain)
          const tenant = await this.tenantSyncService.ensureTenantExists(tenantId);
          if (!tenant) {
            this.logger.error(`Tenant ${tenantId} does not exist and no access token to fetch from auth`);
            throw new BadRequestException(`Tenant ${tenantId} does not exist. Please set up your market first.`);
          }
        }
      } else {
        this.logger.log(`✅ Tenant ${tenantId} verified for site-config update`);
      }

      const { settings, ...siteConfigData } = data;

      // Update Tenant settings if provided
      if (settings) {
        // Extract paymentMethods and hyperpayConfig from settings if present
        const { paymentMethods: pm, hyperpayConfig: hp, subdomain, tenantName, storeType, isPrivateStore, ...restSettings } = settings;
        
        // Update PaymentSettingsService if payment info is present
        if (pm || hp) {
          const paymentUpdate: any = {};
          
          if (pm) {
            paymentUpdate.hyperPayEnabled = pm.includes('HYPERPAY');
            paymentUpdate.stripeEnabled = pm.includes('STRIPE');
            paymentUpdate.payPalEnabled = pm.includes('PAYPAL');
            paymentUpdate.codEnabled = pm.includes('CASH_ON_DELIVERY');
          }

          if (hp) {
            paymentUpdate.hyperPayEntityId = hp.entityId;
            paymentUpdate.hyperPayAccessToken = hp.accessToken;
            paymentUpdate.hyperPayTestMode = hp.testMode;
            // paymentUpdate.hyperPayCurrency = hp.currency; // Not usually editable in this form
          }

          await this.paymentSettingsService.updateSettings(tenantId, paymentUpdate);
        }

        // Update Tenant settings (without payment config)
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { 
            settings: restSettings,
            storeType: storeType || undefined,
            isPrivateStore: isPrivateStore !== undefined ? Boolean(isPrivateStore) : undefined,
          },
        });

        // Sync currency to CurrencySettings if currency was updated
        if (restSettings.currency) {
          const currencyCode = String(restSettings.currency).toUpperCase();
          // Check if currency exists in Currency table
          const currencyExists = await this.prisma.currency.findUnique({
            where: {
              tenantId_code: {
                tenantId,
                code: currencyCode,
              },
            },
          });

          // Only update CurrencySettings if the currency exists
          if (currencyExists) {
            await this.prisma.currencySettings.upsert({
              where: { tenantId },
              update: { baseCurrency: currencyCode },
              create: { tenantId, baseCurrency: currencyCode },
            });
          }
        }
      }

      // Always upsert SiteConfig (excluding payment methods which are handled by PaymentSettingsService)
      const defaults = {
        header: { title: 'Store', links: [] },
        footer: { links: [] },
        background: { type: 'color', value: '#ffffff' },
        language: 'ar',
        theme: 'light',
      };

      // We don't save paymentMethods/hyperpayConfig to SiteConfig anymore as PaymentSettingsService is source of truth
      // But we keep the fields in SiteConfig model for now to avoid schema errors if used elsewhere
      // Ideally we should remove them from SiteConfig model later
      
      // Filter out payment fields from siteConfigData if they exist there too
      const { paymentMethods: _pm, hyperpayConfig: _hp, ...cleanSiteConfigData } = siteConfigData;

      // Validate and clean siteConfigData to ensure it matches the expected schema
      const validatedSiteConfigData: any = {};
      
      // Only include valid SiteConfig fields
      const validFields = ['header', 'footer', 'background', 'language', 'theme'];
      for (const field of validFields) {
        if (cleanSiteConfigData[field] !== undefined) {
          validatedSiteConfigData[field] = cleanSiteConfigData[field];
        }
      }

      const result = await this.prisma.siteConfig.upsert({
        where: { tenantId },
        create: { tenantId, ...defaults, ...validatedSiteConfigData, paymentMethods: [], hyperpayConfig: {} },
        update: { ...validatedSiteConfigData },
      });

      // Update app-auth tenant if store name or logo changes
      if (accessToken && (data.settings?.storeName || data.settings?.storeLogoUrl || data.header?.logo)) {
         try {
            const updateData: any = {};
            if (data.settings?.storeName) updateData.name = data.settings.storeName;
            
            const logo = data.settings?.storeLogoUrl || (data.header && data.header.logo) || undefined;
            if (logo) updateData.logo = logo;
            
            if (Object.keys(updateData).length > 0) {
                 await this.authClientService.updateTenant(tenantId, updateData, accessToken);
            }
         } catch (syncError) {
             this.logger.warn(`Failed to sync tenant updates to auth service: ${syncError}`);
         }
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Error upserting site config for tenant ${tenantId}:`, error);
      
      // Provide more specific error messages
      if (error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      if (error.code === 'P2002') {
        throw new BadRequestException('A configuration with this tenant ID already exists. Please try updating instead.');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Invalid reference in configuration data. Please check your settings.');
      }
      if (error.message?.includes('Unknown arg') || error.message?.includes('Unknown field')) {
        throw new BadRequestException(`Invalid field in configuration: ${error.message}`);
      }
      
      // Generic error with more context
      const errorMsg = error?.message || 'Unknown error';
      this.logger.error(`Site config update error details:`, { errorMsg, errorCode: error?.code, stack: error?.stack });
      throw new BadRequestException(`Failed to update site configuration: ${errorMsg}`);
    }
  }

  async upsertConfigForUser(userId: string, userEmail: string, data: any) {
    // 1. Try to find existing tenant for user
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true }
    });

    if (!user) {
      // User doesn't exist in core service yet (sync issue), create them
      user = await this.prisma.user.create({
        data: {
          id: userId,
          email: userEmail,
          role: 'SHOP_OWNER',
          password: 'placeholder-password', // Password is managed by auth service
        },
        include: { tenant: true }
      });
    }

    let tenantId = user.tenantId;

    if (!tenantId) {
      // Create a new tenant for this user
      // We need a unique subdomain. Let's generate one based on user email or random.
      const subdomain = `store-${randomInt(100000, 999999).toString(36)}`;
      
      const newTenant = await this.prisma.tenant.create({
        data: {
          name: data.settings?.storeName || 'My Store',
          subdomain,
          plan: 'STARTER',
          status: 'ACTIVE',
        }
      });

      tenantId = newTenant.id;

      // Update user with new tenantId and role
      await this.prisma.user.update({
        where: { id: userId },
        data: { 
          tenantId: newTenant.id,
          role: 'SHOP_OWNER' 
        }
      });

      // Create default Home Page
      try {
        await this.pageService.create(newTenant.id, {
          title: 'Home',
          slug: 'home',
          content: JSON.stringify([
            {
              id: 'hero',
              type: 'hero',
              content: {
                title: `Welcome to ${newTenant.name}`,
                subtitle: 'Discover our amazing products',
                buttonText: 'Shop Now',
                buttonLink: '/products'
              }
            }
          ]),
          isPublished: true,
          seoTitle: newTenant.name,
          seoDesc: `Welcome to ${newTenant.name}`,
        });
      } catch (error) {
        console.error('Failed to create default home page:', error);
      }
    }

    return this.upsertConfig(tenantId, data);
  }

  async getTenantIdByUserId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true }
    });
    return user?.tenantId || null;
  }
}

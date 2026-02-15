import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PaymentSettings {
  hyperPayEnabled: boolean;
  hyperPayEntityId?: string;
  hyperPayAccessToken?: string;
  hyperPayTestMode: boolean;
  hyperPayCurrency: string;
  stripeEnabled: boolean;
  stripePublishableKey?: string;
  stripeSecretKey?: string;
  payPalEnabled: boolean;
  payPalClientId?: string;
  payPalSecret?: string;
  payPalMode?: string;
  neoleapEnabled: boolean;
  neoleapClientId?: string;
  neoleapClientSecret?: string;
  neoleapTerminalId?: string;
  neoleapMode?: string;
  codEnabled: boolean;
  walletEnabled: boolean;
}

export interface AvailablePaymentMethod {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
}

interface PaymentMethodRecord {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  credentials?: Record<string, any>;
}

@Injectable()
export class PaymentSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get available payment methods for a tenant from the database
   * Includes both tenant-specific gateways and admin-created global gateways (where tenantId is null)
   * Now respects the payment options toggle settings
   */
  async getAvailablePaymentMethods(tenantId: string): Promise<AvailablePaymentMethod[]> {
    try {
      // Get both tenant-specific gateways and admin-created global gateways (tenantId is null)
      const methods = await this.prisma.paymentMethod.findMany({
        where: {
          OR: [
            tenantId && tenantId !== 'default' ? { tenantId } : undefined,
            { tenantId: null }, // Admin-created global gateways
          ].filter(Boolean) as any,
          isActive: true,
        },
        select: {
          id: true,
          provider: true,
          name: true,
          isActive: true,
          tenantId: true,
        },
        orderBy: [
          { tenantId: 'asc' }, // Tenant-specific first, then global (null comes last)
          { createdAt: 'desc' },
        ],
      });

      // Get enabled payment options for this tenant
      const enabledOptions = await this.prisma.tenantPaymentOption.findMany({
        where: {
          tenantId,
          isEnabled: true,
        },
        select: {
          paymentMethodId: true,
          displayOrder: true,
        },
      });

      const enabledMethodIds = new Set(enabledOptions.map(opt => opt.paymentMethodId));
      const orderMap = new Map(enabledOptions.map(opt => [opt.paymentMethodId, opt.displayOrder]));

      // Filter methods to only include enabled ones (if tenant has configured options)
      // If no options configured, return all methods (backward compatibility)
      let filteredMethods = methods;
      if (enabledOptions.length > 0) {
        filteredMethods = methods.filter(m => enabledMethodIds.has(m.id));
        // Sort by display order
        filteredMethods.sort((a, b) => {
          const orderA = orderMap.get(a.id) || 999;
          const orderB = orderMap.get(b.id) || 999;
          return orderA - orderB;
        });
      }

      // Always include Cash on Delivery as a default option if not already present
      const hasCOD = filteredMethods.some((m: any) => m.provider === 'CASH_ON_DELIVERY');
      if (!hasCOD) {
        filteredMethods.push({
          id: 'default-cod',
          provider: 'CASH_ON_DELIVERY',
          name: 'الدفع عند الاستلام',
          isActive: true,
          tenantId: null,
        });
      }

      return filteredMethods;
    } catch (error) {
      // Return default COD method if there's an error
      console.error('Error fetching available payment methods:', error);
      return [{
        id: 'default-cod',
        provider: 'CASH_ON_DELIVERY',
        name: 'الدفع عند الاستلام',
        isActive: true,
      }];
    }
  }

  /**
   * Get payment settings for a tenant from the database
   * Includes both tenant-specific gateways and admin-created global gateways
   */
  async getSettings(tenantId: string): Promise<PaymentSettings> {
    try {
      // Normalize tenantId: ignore invalid/system tenants
      const effectiveTenantId =
        tenantId && tenantId !== 'default' && tenantId !== 'system'
          ? tenantId
          : undefined;

      // Build where clause:
      // - If we have a real tenantId, include both tenant-specific and global (tenantId=null)
      // - If not, only use global gateways
      const where: any = { isActive: true };

      if (effectiveTenantId) {
        where.OR = [
          { tenantId: effectiveTenantId },
          { tenantId: null },
        ];
      } else {
        where.tenantId = null;
      }

      const methods = await this.prisma.paymentMethod.findMany({ where });

    const hyperPay = methods.find((m: PaymentMethodRecord) => m.provider === 'HYPERPAY');
    const stripe = methods.find((m: PaymentMethodRecord) => m.provider === 'STRIPE');
    const paypal = methods.find((m: PaymentMethodRecord) => m.provider === 'PAYPAL');
    const neoleap = methods.find((m: PaymentMethodRecord) => m.provider === 'NEOLEAP');
    const cod = methods.find((m: PaymentMethodRecord) => m.provider === 'CASH_ON_DELIVERY');
    const wallet = methods.find((m: PaymentMethodRecord) => m.provider === 'WALLET_PAYMENT');

      return {
        hyperPayEnabled: !!hyperPay,
        hyperPayEntityId: hyperPay?.credentials?.entityId,
        hyperPayAccessToken: hyperPay?.credentials?.accessToken,
        hyperPayTestMode: hyperPay?.credentials?.testMode ?? true,
        hyperPayCurrency: hyperPay?.credentials?.currency ?? 'SAR',
        stripeEnabled: !!stripe,
        stripePublishableKey: stripe?.credentials?.publishableKey,
        stripeSecretKey: stripe?.credentials?.secretKey,
        payPalEnabled: !!paypal,
        payPalClientId: paypal?.credentials?.clientId,
        payPalSecret: paypal?.credentials?.secret,
        payPalMode: paypal?.credentials?.mode ?? 'sandbox',
        neoleapEnabled: !!neoleap,
        neoleapClientId: neoleap?.credentials?.clientId,
        neoleapClientSecret: neoleap?.credentials?.clientSecret,
        neoleapTerminalId: neoleap?.credentials?.terminalId,
        neoleapMode: neoleap?.credentials?.mode ?? 'test',
        codEnabled: true, // COD is enabled by default
        walletEnabled: !!wallet,
      };
    } catch (error) {
      // Return default settings if there's an error
      console.error('Error fetching payment settings:', error);
      return {
        hyperPayEnabled: false,
        hyperPayEntityId: undefined,
        hyperPayAccessToken: undefined,
        hyperPayTestMode: true,
        hyperPayCurrency: 'SAR',
        stripeEnabled: false,
        stripePublishableKey: undefined,
        stripeSecretKey: undefined,
        payPalEnabled: false,
        payPalClientId: undefined,
        payPalSecret: undefined,
        payPalMode: 'sandbox',
        neoleapEnabled: false,
        neoleapClientId: undefined,
        neoleapClientSecret: undefined,
        neoleapTerminalId: undefined,
        neoleapMode: 'test',
        codEnabled: true, // COD is enabled by default
        walletEnabled: false,
      };
    }
  }

  /**
   * Update payment settings - creates or updates PaymentMethod records
   */
  async updateSettings(tenantId: string, data: Partial<PaymentSettings>): Promise<PaymentSettings> {
    // Update HyperPay
    if (data.hyperPayEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'HYPERPAY' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: {
            isActive: data.hyperPayEnabled,
            credentials: {
              entityId: data.hyperPayEntityId,
              accessToken: data.hyperPayAccessToken,
              testMode: data.hyperPayTestMode,
              currency: data.hyperPayCurrency,
            },
          },
        });
      } else if (data.hyperPayEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'HYPERPAY',
            name: 'HyperPay',
            isActive: true,
            credentials: {
              entityId: data.hyperPayEntityId,
              accessToken: data.hyperPayAccessToken,
              testMode: data.hyperPayTestMode ?? true,
              currency: data.hyperPayCurrency ?? 'SAR',
            },
          },
        });
      }
    }

    // Update Stripe
    if (data.stripeEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'STRIPE' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: {
            isActive: data.stripeEnabled,
            credentials: {
              publishableKey: data.stripePublishableKey,
              secretKey: data.stripeSecretKey,
            },
          },
        });
      } else if (data.stripeEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'STRIPE',
            name: 'Stripe',
            isActive: true,
            credentials: {
              publishableKey: data.stripePublishableKey,
              secretKey: data.stripeSecretKey,
            },
          },
        });
      }
    }

    // Update PayPal
    if (data.payPalEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'PAYPAL' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: {
            isActive: data.payPalEnabled,
            credentials: {
              clientId: data.payPalClientId,
              secret: data.payPalSecret,
              mode: data.payPalMode,
            },
          },
        });
      } else if (data.payPalEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'PAYPAL',
            name: 'PayPal',
            isActive: true,
            credentials: {
              clientId: data.payPalClientId,
              secret: data.payPalSecret,
              mode: data.payPalMode ?? 'sandbox',
            },
          },
        });
      }
    }

    // Update Neoleap
    if (data.neoleapEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'NEOLEAP' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: {
            isActive: data.neoleapEnabled,
            credentials: {
              clientId: data.neoleapClientId,
              clientSecret: data.neoleapClientSecret,
              terminalId: data.neoleapTerminalId,
              mode: data.neoleapMode,
            },
          },
        });
      } else if (data.neoleapEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'NEOLEAP',
            name: 'Neoleap',
            isActive: true,
            credentials: {
              clientId: data.neoleapClientId,
              clientSecret: data.neoleapClientSecret,
              terminalId: data.neoleapTerminalId,
              mode: data.neoleapMode ?? 'test',
            },
          },
        });
      }
    }

    // Update COD
    if (data.codEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'CASH_ON_DELIVERY' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: { isActive: data.codEnabled },
        });
      } else if (data.codEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'CASH_ON_DELIVERY',
            name: 'الدفع عند الاستلام',
            isActive: true,
            credentials: {},
          },
        });
      }
    }

    // Update Wallet Payment
    if (data.walletEnabled !== undefined) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { tenantId, provider: 'WALLET_PAYMENT' },
      });

      if (existing) {
        await this.prisma.paymentMethod.update({
          where: { id: existing.id },
          data: { isActive: data.walletEnabled },
        });
      } else if (data.walletEnabled) {
        await this.prisma.paymentMethod.create({
          data: {
            tenantId,
            provider: 'WALLET_PAYMENT',
            name: 'الدفع بالرصيد',
            isActive: true,
            credentials: {},
          },
        });
      }
    }

    return this.getSettings(tenantId);
  }

  /**
   * Test HyperPay connection
   */
  async testHyperPayConnection(entityId: string, accessToken: string, testMode: boolean) {
    const baseUrl = testMode
      ? 'https://test.oppwa.com'
      : 'https://oppwa.com';

    try {
      const response = await fetch(`${baseUrl}/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          entityId,
          amount: '1.00',
          currency: 'SAR',
          paymentType: 'DB',
        }),
      });

      if (response.ok) {
        return { success: true, message: 'Connection successful' };
      } else {
        const error = await response.json() as { result?: { description?: string } };
        throw new Error(error?.result?.description || 'Connection failed');
      }
    } catch (error: unknown) {
      const err = error as Error;
      throw new Error(`HyperPay connection failed: ${err.message}`);
    }
  }

  /**
   * Check if a payment method is enabled
   */
  async isPaymentMethodEnabled(tenantId: string, method: 'hyperpay' | 'stripe' | 'paypal' | 'neoleap' | 'cod'): Promise<boolean> {
    const providerMap: Record<string, string> = {
      hyperpay: 'HYPERPAY',
      stripe: 'STRIPE',
      paypal: 'PAYPAL',
      neoleap: 'NEOLEAP',
      cod: 'CASH_ON_DELIVERY',
      wallet: 'WALLET_PAYMENT',
    };

    const provider = providerMap[method];
    if (!provider) return false;

    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: {
        tenantId,
        provider,
        isActive: true,
      },
    });

    // COD is enabled by default if no record exists
    if (method === 'cod' && !paymentMethod) {
      return true;
    }

    return !!paymentMethod;
  }

  /**
   * Get credentials for a specific payment provider
   */
  async getProviderCredentials(tenantId: string, provider: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: {
        tenantId,
        provider,
        isActive: true,
      },
    });

    return method?.credentials || null;
  }
}

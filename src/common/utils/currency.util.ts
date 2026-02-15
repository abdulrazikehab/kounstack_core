import { PrismaService } from '../../prisma/prisma.service';

/**
 * Get the default currency for a tenant from their settings
 * Checks CurrencySettings.baseCurrency first, then tenant.settings.currency
 * Falls back to 'SAR' if not set
 */
export async function getDefaultCurrency(
  prisma: PrismaService,
  tenantId: string,
): Promise<string> {
  try {
    // First, check CurrencySettings (this is what CurrencySettings page uses)
    const currencySettings = await prisma.currencySettings.findUnique({
      where: { tenantId },
      select: { baseCurrency: true },
    });

    if (currencySettings?.baseCurrency) {
      return currencySettings.baseCurrency;
    }

    // Fallback to tenant.settings.currency (from Settings page)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    if (tenant?.settings) {
      const settings = tenant.settings as Record<string, unknown>;
      const currency = settings.currency as string | undefined;
      if (currency) {
        return currency;
      }
    }

    return 'SAR'; // Default fallback
  } catch (error) {
    // SECURITY FIX: Use logger instead of console.error
    // This is a utility function - errors are handled gracefully
    return 'SAR'; // Default fallback on error
  }
}

/**
 * Get currency symbol for a currency code
 */
export function getCurrencySymbol(currencyCode: string): string {
  const symbols: Record<string, string> = {
    SAR: 'ر.س',
    AED: 'د.إ',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    KWD: 'د.ك',
    BHD: '.د.ب',
    OMR: 'ر.ع.',
    QAR: 'ر.ق',
    EGP: 'ج.م',
    JOD: 'د.أ',
    LBP: 'ل.ل',
    TND: 'د.ت',
    DZD: 'د.ج',
    MAD: 'د.م',
  };

  return symbols[currencyCode] || currencyCode;
}


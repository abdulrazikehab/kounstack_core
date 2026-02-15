// prisma/init-currencies.ts
// Script to initialize default currencies for ALL tenants
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Initializing currencies for all tenants...\n');

  // Get ALL existing tenants
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      subdomain: true,
    },
  });

  if (tenants.length === 0) {
    console.log('⚠️ No tenants found in database.');
    return;
  }

  console.log(`👉 Found ${tenants.length} tenant(s):\n`);

  // Default currencies to create
  const defaultCurrencies = [
    {
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

  let totalCreated = 0;
  let totalUpdated = 0;

  // Process each tenant
  for (const tenant of tenants) {
    console.log(`🔄 Processing tenant: ${tenant.name} (${tenant.id})`);
    console.log(`   Subdomain: ${tenant.subdomain}`);

    // Check existing currencies for this tenant
    const existingCurrencies = await prisma.currency.findMany({
      where: { tenantId: tenant.id },
      select: { code: true },
    });

    const existingCodes = new Set(existingCurrencies.map(c => c.code));
    console.log(`   Existing currencies: ${existingCodes.size > 0 ? Array.from(existingCodes).join(', ') : 'none'}`);

    // Create or update currencies
    for (const currency of defaultCurrencies) {
      const currencyData = {
        ...currency,
        tenantId: tenant.id,
      };

      if (existingCodes.has(currency.code)) {
        // Update existing currency
        await prisma.currency.updateMany({
          where: {
            tenantId: tenant.id,
            code: currency.code,
          },
          data: {
            name: currency.name,
            nameAr: currency.nameAr,
            symbol: currency.symbol,
            symbolAr: currency.symbolAr,
            icon: currency.icon,
            exchangeRate: currency.exchangeRate,
            precision: currency.precision,
            isActive: currency.isActive,
            isDefault: currency.isDefault,
            sortOrder: currency.sortOrder,
          },
        });
        totalUpdated++;
        console.log(`   ✅ Updated: ${currency.code} (${currency.nameAr})`);
      } else {
        // Create new currency
        await prisma.currency.create({
          data: currencyData,
        });
        totalCreated++;
        console.log(`   ➕ Created: ${currency.code} (${currency.nameAr})`);
      }
    }

    // Create or update currency settings
    const existingSettings = await prisma.currencySettings.findUnique({
      where: { tenantId: tenant.id },
    });

    if (existingSettings) {
      await prisma.currencySettings.update({
        where: { tenantId: tenant.id },
        data: { baseCurrency: 'SAR' },
      });
      console.log(`   ⚙️  Updated currency settings (base: SAR)`);
    } else {
      await prisma.currencySettings.create({
        data: {
          tenantId: tenant.id,
          baseCurrency: 'SAR',
          autoUpdateRates: false,
        },
      });
      console.log(`   ⚙️  Created currency settings (base: SAR)`);
    }

    console.log('');
  }

  console.log('🎉 Currency initialization complete!');
  console.log(`   Created: ${totalCreated} currencies`);
  console.log(`   Updated: ${totalUpdated} currencies`);
  console.log(`   Processed: ${tenants.length} tenant(s)`);
}

main()
  .catch((e) => {
    console.error('❌ Failed to initialize currencies:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });









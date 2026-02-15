// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Starting seed...');

  // Get ALL existing tenants
  let tenants = await prisma.tenant.findMany();
  
  if (tenants.length === 0) {
    console.log('⚠️ No tenants found. Creating default tenant...');
    
    try {
      const defaultTenant = await prisma.tenant.create({
        data: {
          id: 'default',
          name: 'Default Store',
          nameAr: 'المتجر الافتراضي',
          subdomain: 'default',
          plan: 'STARTER',
          status: 'ACTIVE',
          storeType: 'GENERAL',
          isPrivateStore: false,
          customerRegistrationRequestEnabled: false,
        },
      });
      
      console.log(`✅ Created default tenant: ${defaultTenant.id} (${defaultTenant.name} - ${defaultTenant.subdomain})`);
      tenants = [defaultTenant];
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Tenant already exists (race condition or partial creation)
        console.log('⚠️ Default tenant already exists, fetching...');
        tenants = await prisma.tenant.findMany();
        if (tenants.length === 0) {
          console.error('❌ Failed to create or find default tenant. Please create a tenant manually.');
          process.exit(1);
        }
      } else {
        console.error('❌ Failed to create default tenant:', error);
        process.exit(1);
      }
    }
  }
  
  console.log(`👉 Found ${tenants.length} tenant(s):`);
  tenants.forEach(t => {
    console.log(`   - ${t.id} (${t.name} - ${t.subdomain})`);
  });
  
  // Seed currencies for each tenant
  for (const tenant of tenants) {
    console.log(`\n🔄 Seeding currencies for tenant: ${tenant.name} (${tenant.id})...`);
    
    await seedCurrencies(tenant.id);
  }

  console.log('\n🎉 Seed complete!');
}


// Seed currencies for a tenant
async function seedCurrencies(tenantId: string) {
  console.log('  💱 Seeding currencies...');
  
  const currencies = [
    {
      tenantId,
      code: 'SAR',
      name: 'Saudi Riyal',
      nameAr: 'ريال سعودي',
      symbol: 'ر.س',
      symbolAr: 'ر.س',
      icon: '/assets/currencies/sar.svg', // Official SAR logo
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
      icon: null, // Unicode-based, no icon needed
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

  for (const currency of currencies) {
    const existing = await prisma.currency.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: currency.code,
        },
      },
    });

    if (existing) {
      // Update existing currency
      await prisma.currency.update({
        where: { id: existing.id },
        data: currency,
      });
      console.log(`    ⚠️ Currency ${currency.code} already exists – updated`);
    } else {
      await prisma.currency.create({ data: currency });
      console.log(`    ✅ Created currency: ${currency.code} (${currency.nameAr})`);
    }
  }

  // Create or update currency settings
  const existingSettings = await prisma.currencySettings.findUnique({
    where: { tenantId },
  });

  if (existingSettings) {
    await prisma.currencySettings.update({
      where: { tenantId },
      data: { baseCurrency: 'SAR' },
    });
    console.log('    ⚠️ Currency settings already exist – updated to SAR');
  } else {
    await prisma.currencySettings.create({
      data: {
        tenantId,
        baseCurrency: 'SAR',
        autoUpdateRates: false,
      },
    });
    console.log('    ✅ Created currency settings with SAR as default');
  }
}


main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

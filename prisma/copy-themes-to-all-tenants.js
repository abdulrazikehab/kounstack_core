const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Copying themes to all tenants...\n');
  
  // Get all tenants
  const tenants = await prisma.tenant.findMany();
  
  // Get default themes
  const defaultThemes = await prisma.theme.findMany({
    where: { tenantId: 'default' },
    select: {
      name: true,
      description: true,
      version: true,
      isInstalled: true,
      isActive: true,
      settings: true,
      draftSettings: true,
    }
  });
  
  console.log(`Found ${defaultThemes.length} default themes`);
  console.log(`Found ${tenants.length} tenants\n`);
  
  for (const tenant of tenants) {
    if (tenant.id === 'default') {
      console.log(`⏭️  Skipping default tenant`);
      continue;
    }
    
    console.log(`📦 Processing tenant: ${tenant.name} (${tenant.id})`);
    
    for (const themeData of defaultThemes) {
      // Check if theme already exists for this tenant
      const existing = await prisma.theme.findFirst({
        where: {
          tenantId: tenant.id,
          name: themeData.name
        }
      });
      
      if (existing) {
        console.log(`  ✓ Theme "${themeData.name}" already exists, updating...`);
        await prisma.theme.update({
          where: { id: existing.id },
          data: {
            settings: themeData.settings,
            draftSettings: themeData.draftSettings,
            description: themeData.description,
            version: themeData.version,
          }
        });
      } else {
        console.log(`  + Creating theme "${themeData.name}"...`);
        await prisma.theme.create({
          data: {
            ...themeData,
            tenantId: tenant.id,
          }
        });
      }
    }
    console.log('');
  }
  
  console.log('✅ Done! All tenants now have themes.');
  console.log('\nRun: node prisma/check-db.js to verify');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

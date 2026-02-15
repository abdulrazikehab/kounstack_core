
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const themes = [
    {
      name: 'Default Light',
      description: 'Clean light theme for any store',
      version: '1.0.0',
      isInstalled: true,
      isActive: true,
      settings: {
        colors: {
          '--primary': '239 84% 67%',
          '--primary-foreground': '0 0% 100%',
          '--secondary': '262 83% 58%',
          '--secondary-foreground': '0 0% 100%',
          '--accent': '239 84% 67%',
          '--accent-foreground': '0 0% 100%',
          '--background': '0 0% 100%',
          '--foreground': '222 47% 11%',
        }
      },
    },
    {
      name: 'Dark Mode',
      description: 'Sleek dark theme for modern brands',
      version: '1.0.0',
      isInstalled: true,
      isActive: false,
      settings: {
        colors: {
          '--primary': '239 84% 70%',
          '--primary-foreground': '0 0% 100%',
          '--secondary': '262 83% 65%',
          '--secondary-foreground': '0 0% 100%',
          '--accent': '239 84% 70%',
          '--accent-foreground': '0 0% 100%',
          '--background': '222 47% 11%',
          '--foreground': '210 40% 98%',
          '--card': '222 40% 15%',
          '--card-foreground': '210 40% 98%',
          '--popover': '222 40% 15%',
          '--popover-foreground': '210 40% 98%',
          '--muted': '217 33% 17%',
          '--muted-foreground': '215 20% 65%',
          '--border': '217 33% 17%',
          '--input': '217 33% 17%',
        }
      },
    },
    {
      name: 'Modern Blue',
      description: 'Professional blue accent theme',
      version: '1.0.0',
      isInstalled: true,
      isActive: false,
      settings: {
        colors: {
          '--primary': '221 83% 53%',
          '--primary-foreground': '0 0% 100%',
          '--secondary': '199 89% 48%',
          '--secondary-foreground': '0 0% 100%',
          '--accent': '221 83% 53%',
          '--accent-foreground': '0 0% 100%',
          '--background': '0 0% 100%',
          '--foreground': '222 47% 11%',
        }
      },
    },
    {
      name: 'Fashion Minimal',
      description: 'Minimalist design focused on fashion',
      version: '2.0.0',
      isInstalled: true,
      isActive: false,
      settings: {
        colors: {
          '--primary': '0 0% 9%',
          '--primary-foreground': '0 0% 100%',
          '--secondary': '0 0% 45%',
          '--secondary-foreground': '0 0% 100%',
          '--accent': '0 0% 9%',
          '--accent-foreground': '0 0% 100%',
          '--background': '0 0% 100%',
          '--foreground': '0 0% 9%',
        }
      },
    }
  ];

  // Find a tenant to attach to
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.log('No tenant found. Skipping theme seeding.');
    return;
  }

  console.log(`Seeding themes for tenant: ${tenant.id}`);

  for (const theme of themes) {
    const existing = await prisma.theme.findFirst({
      where: { 
        tenantId: tenant.id,
        name: theme.name
      }
    });

    if (existing) {
      // Update existing theme with new settings
      await prisma.theme.update({
        where: { id: existing.id },
        data: {
          settings: theme.settings,
          draftSettings: theme.settings
        }
      });
      console.log(`Updated theme: ${theme.name}`);
    } else {
      await prisma.theme.create({
        data: {
          ...theme,
          tenantId: tenant.id,
          draftSettings: theme.settings
        }
      });
      console.log(`Seeded theme: ${theme.name}`);
    }
  }
  
  console.log('\n✅ Theme seeding complete!');
  console.log('Run: node prisma/list-themes.js to see all themes');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

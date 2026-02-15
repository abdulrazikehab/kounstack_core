const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('📊 Checking database state...\n');
  
  // List all tenants
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      subdomain: true,
      _count: {
        select: {
          themes: true,
          users: true,
        }
      }
    }
  });
  
  console.log('🏢 Tenants:');
  tenants.forEach(tenant => {
    console.log(`  - ID: ${tenant.id}`);
    console.log(`    Name: ${tenant.name}`);
    console.log(`    Subdomain: ${tenant.subdomain}`);
    console.log(`    Themes: ${tenant._count.themes}`);
    console.log(`    Users: ${tenant._count.users}`);
    console.log('');
  });
  
  // List all themes
  const themes = await prisma.theme.findMany({
    select: {
      id: true,
      name: true,
      tenantId: true,
      isActive: true,
    }
  });
  
  console.log('🎨 Themes:');
  themes.forEach(theme => {
    console.log(`  - ${theme.name} (${theme.isActive ? 'ACTIVE' : 'inactive'})`);
    console.log(`    ID: ${theme.id}`);
    console.log(`    Tenant ID: ${theme.tenantId}`);
    console.log('');
  });
  
  // List all users
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      tenantId: true,
      role: true,
    }
  });
  
  console.log('👥 Users:');
  users.forEach(user => {
    console.log(`  - ${user.email}`);
    console.log(`    ID: ${user.id}`);
    console.log(`    Tenant ID: ${user.tenantId || 'NULL'}`);
    console.log(`    Role: ${user.role}`);
    console.log('');
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

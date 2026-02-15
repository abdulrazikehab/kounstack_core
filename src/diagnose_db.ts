import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Diagnostics ---');
  
  // 1. Check Tenants
  const tenants = await prisma.tenant.findMany({
    select: { id: true, subdomain: true, name: true }
  });
  console.log('\nTenants:');
  tenants.forEach(t => console.log(`ID: ${t.id}, Subdomain: ${t.subdomain}, Name: ${t.name}`));

  // 2. Check CardInventory
  const cardInventoryCount = await prisma.cardInventory.count();
  console.log(`\nTotal CardInventory records: ${cardInventoryCount}`);
  
  if (cardInventoryCount > 0) {
    const cards = await prisma.cardInventory.findMany({
      take: 20,
      include: {
        product: { select: { name: true } },
        tenant: { select: { subdomain: true } },
        soldToUser: { select: { email: true } }
      }
    });
    
    console.log('\nSample Cards:');
    cards.forEach((c: any) => {
      console.log(`ID: ${c.id}, Tenant: ${c.tenant?.subdomain || c.tenantId}, SN: ${c.cardCode}, Status: ${c.status}, User: ${c.soldToUser?.email || c.soldToUserId || 'None'}`);
    });
  }

  // 3. Check for the specific tenant from logs
  const targetSubdomain = 'asus130';
  const targetTenant = tenants.find(t => t.subdomain.includes(targetSubdomain));
  if (targetTenant) {
    console.log(`\nFound target tenant: ${targetTenant.id} (${targetTenant.subdomain})`);
    const tenantCards = await prisma.cardInventory.count({ where: { tenantId: targetTenant.id } });
    console.log(`Cards for this tenant: ${tenantCards}`);
    
    // Check if any cards for this tenant are SOLD to users
    const soldCards = await prisma.cardInventory.findMany({
      where: { tenantId: targetTenant.id, NOT: { soldToUserId: null } },
      include: { soldToUser: { select: { email: true } } }
    });
    console.log(`Sold cards for this tenant: ${soldCards.length}`);
    soldCards.forEach((c: any) => {
        console.log(`  - Card ${c.cardCode} sold to ${c.soldToUser?.email || c.soldToUserId}`);
    });
  } else {
    console.log(`\nCould not find tenant with subdomain starting with "${targetSubdomain}"`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

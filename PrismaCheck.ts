
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- DEBUG INFO ---');
  console.log('DB URL:', process.env.DATABASE_URL);
  
  const tenants = await prisma.tenant.findMany({
    select: { id: true, subdomain: true, name: true }
  });
  console.log('Tenants:', JSON.stringify(tenants, null, 2));

  const totalCards = await prisma.cardInventory.count();
  console.log('Total CardInventory records:', totalCards);

  const sampleCards = await prisma.cardInventory.findMany({
    take: 10,
    include: { product: { select: { name: true } } }
  });
  console.log('Sample Cards:', JSON.stringify(sampleCards, null, 2));

  const totalOrders = await prisma.order.count();
  console.log('Total Orders:', totalOrders);

  const sampleOrders = await prisma.order.findMany({
    take: 20,
    select: { id: true, orderNumber: true, customerEmail: true, guestEmail: true, status: true, tenantId: true, deliveryFiles: true }
  });
  
  const ordersWithFiles = sampleOrders.filter(o => o.deliveryFiles !== null);
  console.log('Sample Orders with DeliveryFiles (found in first 20):', JSON.stringify(ordersWithFiles, null, 2));

  // Check specifically for asus130
  const asusTenant = tenants.find(t => t.subdomain.includes('asus130') || t.id.includes('asus130'));
  if (asusTenant) {
     const asusCards = await prisma.cardInventory.findMany({
       where: { tenantId: asusTenant.id },
       take: 10
     });
     console.log(`Cards for tenant ${asusTenant.id}:`, JSON.stringify(asusCards, null, 2));
     
     const asusOrdersRaw = await prisma.order.findMany({
        where: { tenantId: asusTenant.id },
        take: 50
     });
     const asusOrdersWithFiles = asusOrdersRaw.filter(o => o.deliveryFiles !== null);
     console.log(`Orders for tenant ${asusTenant.id} with delivery files (found in first 50):`, JSON.stringify(asusOrdersWithFiles, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

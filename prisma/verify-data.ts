// verify-data.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking database...\n');
  
  // Check tenants
  const tenants = await prisma.tenant.findMany();
  console.log(`📊 Total tenants: ${tenants.length}`);
  tenants.forEach(t => {
    console.log(`  - ${t.id} (${t.name} - ${t.subdomain})`);
  });
  
  console.log('\n');
  
  // Check categories
  const categories = await prisma.category.findMany();
  console.log(`📊 Total categories: ${categories.length}`);
  categories.forEach(c => {
    console.log(`  - ${c.id} (${c.name}) - Tenant: ${c.tenantId}`);
  });
  
  console.log('\n');
  
  // Check products
  const products = await prisma.product.findMany({
    include: {
      categories: {
        include: {
          category: true
        }
      }
    }
  });
  console.log(`📊 Total products: ${products.length}`);
  products.forEach(p => {
    const cats = p.categories.map(pc => pc.category.name).join(', ');
    console.log(`  - ${p.name} (SKU: ${p.sku}) - Tenant: ${p.tenantId} - Categories: ${cats}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

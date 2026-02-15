import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('--- Supplier Diagnostics ---');
  
  const suppliers = await prisma.supplier.findMany();
  console.log(`Found ${suppliers.length} suppliers:`);
  
  suppliers.forEach(s => {
    console.log(`\nID: ${s.id}`);
    console.log(`Name: ${s.name}`);
    console.log(`Type: ${s.supplierType}`);
    console.log(`Status: ${s.isActive ? 'Active' : 'Inactive'}`);
    console.log(`Config: ${JSON.stringify(s.apiConfig, null, 2)}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

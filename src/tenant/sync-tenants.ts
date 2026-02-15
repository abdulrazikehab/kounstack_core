import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function syncTenants() {
  console.log('🔄 Syncing tenants from auth service to core service...');
  
  // This is a manual process - you'll need to get tenant data from your auth database
  // For now, create a test tenant manually
  const testTenantId = 'your-actual-tenant-id-from-jwt'; // Get this from your JWT token
  
  try {
    await prisma.tenant.upsert({
      where: { id: testTenantId },
      update: {},
      create: {
        id: testTenantId,
        name: 'Test Store',
        subdomain: 'test-store',
        plan: 'STARTER',
        status: 'ACTIVE',
      },
    });
    
    console.log('✅ Test tenant created in core database');
  } catch (error) {
    console.error('❌ Failed to sync tenants:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncTenants();
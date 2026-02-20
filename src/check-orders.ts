
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const orders = await prisma.order.findMany();
    console.log('General Orders:', JSON.stringify(orders.map(o => ({
        id: o.id,
        tenantId: o.tenantId,
        customerEmail: o.customerEmail,
        isGuest: o.isGuest
    })), null, 2));

    const cardOrders = await prisma.cardOrder.findMany();
    console.log('Card Orders:', JSON.stringify(cardOrders.map(o => ({
        id: o.id,
        tenantId: o.tenantId,
        userId: o.userId,
        orderNumber: o.orderNumber
    })), null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

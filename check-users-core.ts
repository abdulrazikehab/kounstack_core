
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const userId = 'a1737004-bc8c-4d67-8a3d-a847aa2ac99d';
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true }
    });
    console.log('--- User in app-core ---');
    console.log(JSON.stringify(user, null, 2));

    const allUsers = await prisma.user.findMany({
      take: 5,
      select: { id: true, email: true, role: true }
    });
    console.log('--- Some Users in app-core ---');
    console.log(JSON.stringify(allUsers, null, 2));
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

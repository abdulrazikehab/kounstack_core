const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const themes = await prisma.theme.findMany();
  console.log('Existing themes:');
  themes.forEach(theme => {
    console.log(`ID: ${theme.id}, Name: ${theme.name}, Active: ${theme.isActive}`);
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

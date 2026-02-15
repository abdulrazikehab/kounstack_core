-- AlterTable
ALTER TABLE "products" ADD COLUMN     "featuredEndDate" TIMESTAMP(3),
ADD COLUMN     "featuredPriceCurrency" TEXT DEFAULT 'SAR',
ADD COLUMN     "featuredPriceIncrease" DECIMAL(65,30),
ADD COLUMN     "featuredStartDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "costCurrency" TEXT DEFAULT 'SAR',
ADD COLUMN     "displayCurrency" TEXT DEFAULT 'SAR',
ADD COLUMN     "priceCurrency" TEXT DEFAULT 'SAR';

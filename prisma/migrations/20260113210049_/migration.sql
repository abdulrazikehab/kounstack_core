-- AlterEnum
ALTER TYPE "SupplierType" ADD VALUE 'SUPPLIER_HUB';

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "seoDescAr" TEXT,
ADD COLUMN     "seoDescEn" TEXT,
ADD COLUMN     "seoTitleAr" TEXT,
ADD COLUMN     "seoTitleEn" TEXT,
ADD COLUMN     "titleAr" TEXT,
ADD COLUMN     "titleEn" TEXT;

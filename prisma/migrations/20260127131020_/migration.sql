/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CustomerRegistrationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoreType" ADD VALUE 'B2B';
ALTER TYPE "StoreType" ADD VALUE 'B2C';

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "parentCategoryId" TEXT;

-- AlterTable
ALTER TABLE "currencies" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryFiles" JSONB;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "isPrivateStore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameAr" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "wallet_topup_requests" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "customer_registration_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "storeName" TEXT,
    "activity" TEXT,
    "companyName" TEXT,
    "city" TEXT,
    "country" TEXT,
    "status" "CustomerRegistrationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "registrationUrl" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedByUserId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "currency" TEXT,
    "face_value" DECIMAL(65,30) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_product_id" TEXT NOT NULL,
    "buy_price" DECIMAL(65,30) NOT NULL,
    "is_available" BOOLEAN NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_registration_requests_tenantId_idx" ON "customer_registration_requests"("tenantId");

-- CreateIndex
CREATE INDEX "customer_registration_requests_status_idx" ON "customer_registration_requests"("status");

-- CreateIndex
CREATE INDEX "customer_registration_requests_createdAt_idx" ON "customer_registration_requests"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_registration_requests_tenantId_email_key" ON "customer_registration_requests"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_product_code_key" ON "supplier_products"("product_code");

-- CreateIndex
CREATE INDEX "brands_parentCategoryId_idx" ON "brands"("parentCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_registration_requests" ADD CONSTRAINT "customer_registration_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_registration_requests" ADD CONSTRAINT "customer_registration_requests_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

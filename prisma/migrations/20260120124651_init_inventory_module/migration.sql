-- CreateEnum
CREATE TYPE "InventoryType" AS ENUM ('DEFAULT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CATEGORY', 'BRAND', 'PRODUCT');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isNeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "emergency_inventory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_visibility_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inventoryType" "InventoryType" NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_visibility_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emergency_inventory_tenantId_idx" ON "emergency_inventory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_inventory_tenantId_productId_key" ON "emergency_inventory"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "inventory_visibility_overrides_tenantId_inventoryType_idx" ON "inventory_visibility_overrides"("tenantId", "inventoryType");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_visibility_overrides_tenantId_inventoryType_entit_key" ON "inventory_visibility_overrides"("tenantId", "inventoryType", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "emergency_inventory" ADD CONSTRAINT "emergency_inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_inventory" ADD CONSTRAINT "emergency_inventory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_visibility_overrides" ADD CONSTRAINT "inventory_visibility_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

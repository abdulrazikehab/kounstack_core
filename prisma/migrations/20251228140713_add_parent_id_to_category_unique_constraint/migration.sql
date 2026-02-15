/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,slug,parentId]` on the table `categories` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "categories_tenantId_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_slug_parentId_key" ON "categories"("tenantId", "slug", "parentId");

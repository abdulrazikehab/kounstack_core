-- DropForeignKey
ALTER TABLE "card_inventory" DROP CONSTRAINT "card_inventory_productId_fkey";

-- DropForeignKey
ALTER TABLE "card_order_items" DROP CONSTRAINT "card_order_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_cart_items" DROP CONSTRAINT "merchant_cart_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_favorites" DROP CONSTRAINT "merchant_favorites_productId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_favorites_v2" DROP CONSTRAINT "merchant_favorites_v2_productId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_order_items" DROP CONSTRAINT "merchant_order_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_product_overrides" DROP CONSTRAINT "merchant_product_overrides_productId_fkey";

-- DropForeignKey
ALTER TABLE "price_alert_subscriptions" DROP CONSTRAINT "price_alert_subscriptions_productId_fkey";

-- DropForeignKey
ALTER TABLE "product_price_history" DROP CONSTRAINT "product_price_history_productId_fkey";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "stockCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "card_inventory" ADD CONSTRAINT "card_inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_order_items" ADD CONSTRAINT "card_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_favorites" ADD CONSTRAINT "merchant_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_cart_items" ADD CONSTRAINT "merchant_cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_order_items" ADD CONSTRAINT "merchant_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alert_subscriptions" ADD CONSTRAINT "price_alert_subscriptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_favorites_v2" ADD CONSTRAINT "merchant_favorites_v2_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_product_overrides" ADD CONSTRAINT "merchant_product_overrides_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CardProductService } from '../../cards/card-product.service';
import { AddCartItemDto, UpdateCartItemDto, CartResponse } from '../dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class MerchantCartService {
  private readonly logger = new Logger(MerchantCartService.name);

  constructor(
    private prisma: PrismaService,
    private cardProductService: CardProductService,
  ) {}

  // Get or create cart for merchant/employee
  async getOrCreateCart(merchantId: string, employeeId?: string) {
    let cart = await this.prisma.merchantCart.findFirst({
      where: { merchantId, employeeId: employeeId || null },
    });

    if (!cart) {
      cart = await this.prisma.merchantCart.create({
        data: {
          merchantId,
          employeeId,
          currency: 'SAR',
        },
      });
    }

    return cart;
  }

  // Get cart with full details
  async getCart(merchantId: string, tenantId: string, employeeId?: string): Promise<CartResponse> {
    const cart = await this.getOrCreateCart(merchantId, employeeId);

    const cartWithItems = await this.prisma.merchantCart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: {
              include: { 
                brand: true,
                images: { take: 1, orderBy: { sortOrder: 'asc' } }
              },
            },
          },
        },
      },
    });


    if (!cartWithItems) {
      throw new NotFoundException('Cart not found');
    }

    // Calculate totals and build response
    let subtotal = new Decimal(0);
    let discountTotal = new Decimal(0);
    let taxTotal = new Decimal(0);

    const items = cartWithItems.items.map((item) => {
      const product = item.product;
      // Use costPerItem as wholesale price, fallback to price
      const effectivePrice = new Decimal(product.costPerItem || product.price);
      const lineTotal = effectivePrice.times(item.quantity);
      // Fallback tax rate to 0.15 if not specified (Product doesn't have taxRate field)
      const taxRate = 0.15; 
      const lineTax = lineTotal.times(taxRate);

      subtotal = subtotal.plus(lineTotal);
      taxTotal = taxTotal.plus(lineTax);

      return {
        id: item.id,
        productId: product.id,
        productName: product.name,
        productNameAr: product.nameAr,
        productImage: product.images?.[0]?.url || null,
        qty: item.quantity,
        effectiveUnitPrice: effectivePrice.toNumber(),
        lineTotal: lineTotal.toNumber(),
        minQty: product.min || 1,
        maxQty: product.max || 1000,
        availableStock: product.isAvailable ? 999 : 0, // Simplified for now
        metadata: item.metadata,
      };

    });

    const total = subtotal.minus(discountTotal).plus(taxTotal);

    return {
      cartId: cart.id,
      currency: cart.currency,
      items,
      totals: {
        subtotal: subtotal.toNumber(),
        discountTotal: discountTotal.toNumber(),
        feesTotal: 0,
        taxTotal: taxTotal.toNumber(),
        total: total.toNumber(),
      },
    };
  }

  // Add or update cart item
  async addItem(merchantId: string, tenantId: string, dto: AddCartItemDto, employeeId?: string) {
    const cart = await this.getOrCreateCart(merchantId, employeeId);

    // DEBUG LOGGING
    this.logger.log(`Attempting to add product: ${dto.productId}`);
    
    const productData = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: {
        brand: true,
        images: { take: 1, orderBy: { sortOrder: 'asc' } }
      },
    });

    if (!productData) {
      this.logger.warn(`Product ${dto.productId} not found in database.`);
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }

    const product = {
      ...productData,
      availableStock: productData.isAvailable ? 999 : 0,
    };

    if (!product.isAvailable) {
      throw new BadRequestException('Product is not available');
    }


    // If qty is 0, remove the item
    if (dto.qty === 0) {
      await this.prisma.merchantCartItem.deleteMany({
        where: { cartId: cart.id, productId: dto.productId },
      });
      return this.getCart(merchantId, tenantId, employeeId);
    }

    // Validate quantity
    const minQty = product.min || 1;
    const maxQty = product.max || 1000;

    if (dto.qty < minQty) {
      throw new BadRequestException(`Minimum quantity is ${minQty}`);
    }
    if (dto.qty > maxQty) {
      throw new BadRequestException(`Maximum quantity is ${maxQty}`);
    }

    // Upsert cart item
    await this.prisma.merchantCartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      update: {
        quantity: dto.qty,
        metadata: dto.metadata as any,
        unitPriceSnapshot: product.costPerItem || product.price,
      },
      create: {
        cartId: cart.id,
        productId: dto.productId,
        quantity: dto.qty,
        metadata: dto.metadata as any,
        unitPriceSnapshot: product.costPerItem || product.price,
      },
    });


    this.logger.log(`Updated cart ${cart.id} - product ${dto.productId} qty ${dto.qty}`);

    return this.getCart(merchantId, tenantId, employeeId);
  }

  // Update cart item quantity
  async updateItem(merchantId: string, tenantId: string, itemId: string, dto: UpdateCartItemDto, employeeId?: string) {
    const cart = await this.getOrCreateCart(merchantId, employeeId);

    const item = await this.prisma.merchantCartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    // If qty is 0, remove the item
    if (dto.qty === 0) {
      await this.prisma.merchantCartItem.delete({
        where: { id: itemId },
      });
      return this.getCart(merchantId, tenantId, employeeId);
    }

    // Validate quantity
    const minQty = item.product.min || 1;
    const maxQty = item.product.max || 1000;

    if (dto.qty < minQty) {
      throw new BadRequestException(`Minimum quantity is ${minQty}`);
    }
    if (dto.qty > maxQty) {
      throw new BadRequestException(`Maximum quantity is ${maxQty}`);
    }


    await this.prisma.merchantCartItem.update({
      where: { id: itemId },
      data: { quantity: dto.qty },
    });

    return this.getCart(merchantId, tenantId, employeeId);
  }

  // Remove cart item
  async removeItem(merchantId: string, tenantId: string, itemId: string, employeeId?: string) {
    const cart = await this.getOrCreateCart(merchantId, employeeId);

    const item = await this.prisma.merchantCartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.merchantCartItem.delete({
      where: { id: itemId },
    });

    return this.getCart(merchantId, tenantId, employeeId);
  }

  // Clear cart
  async clearCart(merchantId: string, tenantId: string, employeeId?: string) {
    const cart = await this.getOrCreateCart(merchantId, employeeId);

    await this.prisma.merchantCartItem.deleteMany({
      where: { cartId: cart.id },
    });

    this.logger.log(`Cleared cart ${cart.id}`);

    return { ok: true };
  }

  // Get cart items for order creation
  async getCartItemsForOrder(cartId: string, tenantId: string) {
    const cart = await this.prisma.merchantCart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    return cart;
  }
}


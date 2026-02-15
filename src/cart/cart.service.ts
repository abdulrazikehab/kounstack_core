import { Injectable, Logger, NotFoundException, BadRequestException, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CouponService } from '../coupon/coupon.service';
import { TaxService } from '../tax/tax.service';
import { ShippingService } from '../shipping/shipping.service';
import { CouponType } from '@prisma/client';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(RedisService) private redisService?: RedisService,
    @Optional() private couponService?: CouponService,
    @Optional() private taxService?: TaxService,
    @Optional() private shippingService?: ShippingService,
  ) {}

  async getOrCreateCart(tenantId: string, sessionId?: string, userId?: string) {
    this.logger.log(`getOrCreateCart called - tenantId: ${tenantId}, sessionId: ${sessionId || 'none'}, userId: ${userId || 'none'}`);
    
    // Try Redis cache first if available, but verify it exists in database
    if (this.redisService && sessionId) {
      const cachedCart = await this.redisService.getCartSession(sessionId);
      if (cachedCart && cachedCart.id) {
        // Verify cart exists in database and get fresh data
        try {
          const dbCart = await this.prisma.cart.findFirst({
            where: { id: cachedCart.id, tenantId },
            include: {
              cartItems: {
                include: {
                  product: {
                    include: {
                      images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                      categories: { select: { id: true } }
                    }
                  },
                  productVariant: true
                },
                orderBy: { createdAt: 'asc' }
              }
            }
          });
          if (dbCart) {
            this.logger.log(`Retrieved cart from Redis cache and verified in DB: ${sessionId}, items: ${dbCart.cartItems?.length || 0}`);
            // Update Redis with fresh data
            await this.redisService.setCartSession(sessionId, dbCart);
            return dbCart;
          } else {
            this.logger.warn(`Cart ${cachedCart.id} from Redis not found in database, will fetch/create from database`);
            // Clear stale Redis cache
            await this.redisService.deleteCartSession(sessionId);
          }
        } catch (error) {
          this.logger.warn(`Error verifying cached cart in database: ${error}, will fetch from database`);
        }
      }
    }

    let cart;

    // Try to find existing cart in database
    // Priority: 1. userId + sessionId (most specific), 2. userId only, 3. sessionId only
    if (userId && sessionId) {
      // First try to find cart with both userId and sessionId
      cart = await this.prisma.cart.findFirst({
        where: { tenantId, userId, sessionId },
        include: { 
          cartItems: { 
            include: { 
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                  categories: { select: { id: true } }
                }
              }, 
              productVariant: true 
            } 
          } 
        },
      });
      this.logger.log(`Cart search by userId+sessionId: ${cart ? `found (${cart.cartItems?.length || 0} items)` : 'not found'}`);
    }
    
    if (!cart && userId) {
      // If not found, try by userId only
      cart = await this.prisma.cart.findFirst({
        where: { tenantId, userId },
        include: { 
          cartItems: { 
            include: { 
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                  categories: { select: { id: true } }
                }
              }, 
              productVariant: true 
            } 
          } 
        },
      });
      this.logger.log(`Cart search by userId only: ${cart ? `found (${cart.cartItems?.length || 0} items)` : 'not found'}`);
      
      // If found by userId but sessionId is different, update it
      if (cart && sessionId && cart.sessionId !== sessionId) {
        this.logger.log(`Updating cart sessionId from ${cart.sessionId} to ${sessionId}`);
        cart = await this.prisma.cart.update({
          where: { id: cart.id },
          data: { sessionId },
          include: { 
            cartItems: { 
              include: { 
                product: {
                  include: {
                    images: { orderBy: { sortOrder: 'asc' }, take: 1 },
                    categories: { select: { id: true } }
                  }
                }, 
                productVariant: true 
              } 
            } 
          },
        });
      }
    }
    
    if (!cart && sessionId) {
      // If still not found, try by sessionId only
      cart = await this.prisma.cart.findFirst({
        where: { tenantId, sessionId },
        include: { 
          cartItems: { 
            include: { 
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                  categories: { select: { id: true } }
                }
              }, 
              productVariant: true 
            } 
          } 
        },
      });
      this.logger.log(`Cart search by sessionId only: ${cart ? `found (${cart.cartItems?.length || 0} items)` : 'not found'}`);
      
      // If found by sessionId but userId is different, update it
      if (cart && userId && cart.userId !== userId) {
        this.logger.log(`Updating cart userId from ${cart.userId} to ${userId}`);
        cart = await this.prisma.cart.update({
          where: { id: cart.id },
          data: { userId },
          include: { 
            cartItems: { 
              include: { 
                product: {
                  include: {
                    images: { orderBy: { sortOrder: 'asc' }, take: 1 },
                    categories: { select: { id: true } }
                  }
                }, 
                productVariant: true 
              } 
            } 
          },
        });
      }
    }

    // Create new cart if not found
    if (!cart) {
      console.log('🛒 Creating new cart for tenant:', tenantId);
      // Verify tenant exists first
      const tenantExists = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenantExists) {
        console.error(`❌ Tenant ${tenantId} does not exist! Cannot create cart.`);
        throw new NotFoundException(`Tenant ${tenantId} not found`);
      }

      cart = await this.prisma.cart.create({
        data: {
          tenantId,
          sessionId,
          userId,
        },
        include: { 
          cartItems: { 
            include: { 
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                  categories: { select: { id: true } }
                }
              }, 
              productVariant: true 
            } 
          } 
        },
      });
    }

    // Ensure cartItems is always an array (even if empty)
    if (!cart.cartItems) {
      cart.cartItems = [];
    }
    
    // Ensure all cart items have complete product data
    if (cart.cartItems.length > 0) {
      for (const item of cart.cartItems) {
        if (!item.product) {
          // Reload product if missing
          try {
            const product = await this.prisma.product.findFirst({
              where: { id: item.productId, tenantId },
              include: {
                images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                categories: { select: { id: true } }
              }
            });
            if (product) {
              item.product = product;
            }
          } catch (error) {
            this.logger.error(`Error reloading product ${item.productId} for cart item ${item.id}:`, error);
          }
        }
      }
    }
    
    this.logger.log(`Returning cart - cartId: ${cart.id}, items: ${cart.cartItems.length}, sessionId: ${cart.sessionId || sessionId}, userId: ${cart.userId || userId}`);
    


    // Cache in Redis if available
    if (this.redisService && (cart.sessionId || sessionId)) {
      const cacheSessionId = cart.sessionId || sessionId;
      await this.redisService.setCartSession(cacheSessionId, cart);
      this.logger.log(`Cached cart in Redis: ${cacheSessionId}, items: ${cart.cartItems.length}`);
    }

    return cart;
  }

  async addToCart(
    tenantId: string,
    cartId: string,
    productId: string,
    quantity: number,
    productVariantId?: string,
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: { variants: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, categories: { select: { id: true } } },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verify variant exists if provided, or auto-select first variant if product has variants
    let selectedVariant: { id: string; inventoryQuantity: number; trackInventory: boolean } | null = null;
    let finalVariantId = productVariantId;
    
    // If product has variants but no variantId provided, use the first variant automatically
    if (product.variants.length > 0 && !productVariantId) {
      finalVariantId = product.variants[0].id;
      this.logger.log(`Auto-selecting first variant ${finalVariantId} for product ${productId}`);
    }
    
    if (finalVariantId) {
      selectedVariant = product.variants.find((v: any) => v.id === finalVariantId) as { id: string; inventoryQuantity: number; trackInventory: boolean } | undefined || null;
      if (!selectedVariant) {
        throw new NotFoundException('Product variant not found');
      }
      
      // Log variant details for debugging
      this.logger.log(`Variant ${finalVariantId}: trackInventory=${selectedVariant.trackInventory}, inventoryQuantity=${selectedVariant.inventoryQuantity}, requestedQuantity=${quantity}`);
      
      // Check inventory only if tracking is enabled (default is true, so we check if it's explicitly false)
      // If trackInventory is undefined/null, default to true (track inventory)
      const shouldTrackInventory = selectedVariant.trackInventory !== false;
      
      // Allow adding to cart even with 0 inventory - we'll check inventory at checkout
      // Only warn if inventory is low but don't block adding to cart
      if (shouldTrackInventory && selectedVariant.inventoryQuantity < quantity) {
        // If product is available, allow adding to cart (might be backorder or restocking)
        // We'll enforce inventory limits at checkout
        if (product.isAvailable) {
          this.logger.warn(`Low inventory for variant ${finalVariantId}: ${selectedVariant.inventoryQuantity} available, requested ${quantity}. Allowing add to cart (will check at checkout).`);
        } else {
          throw new BadRequestException(`Product is not available at this time. Only ${selectedVariant.inventoryQuantity} items available.`);
        }
      }
      
      // If inventory tracking is disabled, allow adding to cart regardless of inventory
      if (!shouldTrackInventory) {
        this.logger.log(`Inventory tracking disabled for variant ${finalVariantId}, allowing add to cart`);
      }
    }

    // Check if item already in cart (use finalVariantId which may have been auto-selected)
    // IMPORTANT: Match by cartId + productId + productVariantId to allow multiple different products
    const existingItem = await this.prisma.cartItem.findFirst({
      where: {
        cartId,
        productId,
        productVariantId: finalVariantId || null,
      },
    });

    this.logger.log(`Checking for existing cart item - cartId: ${cartId}, productId: ${productId}, variantId: ${finalVariantId || 'none'}, found: ${existingItem ? 'yes' : 'no'}`);

    let cartItem;
    if (existingItem) {
      this.logger.log(`Existing item found - itemId: ${existingItem.id}, current quantity: ${existingItem.quantity}, adding: ${quantity}`);
      const newQuantity = existingItem.quantity + quantity;
      
      // Check inventory again for updated quantity (only if tracking is enabled)
      // Allow updating quantity even with low inventory - we'll check at checkout
      if (selectedVariant && selectedVariant.trackInventory !== false && selectedVariant.inventoryQuantity < newQuantity) {
        if (product.isAvailable) {
          this.logger.warn(`Low inventory for variant ${selectedVariant.id}: ${selectedVariant.inventoryQuantity} available, requested ${newQuantity}. Allowing update (will check at checkout).`);
        } else {
          throw new BadRequestException(`Product is not available at this time. Cannot add ${quantity} more items. Only ${selectedVariant.inventoryQuantity - existingItem.quantity} items available.`);
        }
      }

      // Update quantity
      cartItem = await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
        include: { 
          product: {
            include: {
              images: { orderBy: { sortOrder: 'asc' }, take: 10 },
              categories: { select: { id: true } }
            }
          }, 
          productVariant: true 
        },
      });
      this.logger.log(`✅ Updated existing cart item ${cartItem.id} - new quantity: ${newQuantity}`);
    } else {
      // Create new cart item - this allows multiple different products in the same cart
      this.logger.log(`Creating new cart item for product ${productId} in cart ${cartId}`);
      cartItem = await this.prisma.cartItem.create({
        data: {
          cartId,
          productId,
          productVariantId: finalVariantId,
          quantity,
        },
        include: { 
          product: {
            include: {
              images: { orderBy: { sortOrder: 'asc' }, take: 10 },
              categories: { select: { id: true } }
            }
          }, 
          productVariant: true 
        },
      });
      this.logger.log(`✅ Created new cart item ${cartItem.id} for product ${productId}`);
    }

    // CRITICAL: Verify the cart item has the correct product
    if (!cartItem.product) {
      this.logger.error(`❌ CRITICAL: Cart item ${cartItem.id} created but product is null! productId: ${productId}`);
      throw new BadRequestException('Failed to link product to cart. Product data is missing.');
    }
    
    if (cartItem.product.id !== productId) {
      this.logger.error(`❌ CRITICAL: Product ID mismatch! Expected ${productId}, got ${cartItem.product.id}`);
      throw new BadRequestException('Error identifying product. Please try again.');
    }
    
    this.logger.log(`✅ Added product ${productId} (${cartItem.product.name || cartItem.product.nameAr || 'Unknown'}) to cart ${cartId}, cartItem: ${cartItem.id}, quantity: ${quantity}`);

    // Get the updated cart with all items - ensure fresh data from database
    const cart = await this.getCartById(tenantId, cartId);
    this.logger.log(`📦 Cart retrieved after add - cartId: ${cart.id}, total items: ${cart.cartItems?.length || 0}, sessionId: ${cart.sessionId}`);
    
    // Verify the item we just added is in the cart with correct product
    if (cart.cartItems && cart.cartItems.length > 0) {
      const addedItemInCart = cart.cartItems.find((item: any) => item.id === cartItem.id);
      if (addedItemInCart) {
        if (addedItemInCart.product && addedItemInCart.product.id === productId) {
          this.logger.log(`✅ Verified: Cart item ${cartItem.id} has correct product ${productId} (${addedItemInCart.product.name || addedItemInCart.product.nameAr}), quantity: ${addedItemInCart.quantity}`);
        } else {
          this.logger.error(`❌ CRITICAL: Cart item ${cartItem.id} has wrong product! Expected ${productId}, got ${addedItemInCart.product?.id || 'null'}`);
          // Try to reload the cart item with product
          const reloadedItem = await this.prisma.cartItem.findFirst({
            where: { id: cartItem.id },
            include: {
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, take: 10 },
                  categories: { select: { id: true } }
                }
              },
              productVariant: true
            }
          });
          if (reloadedItem && reloadedItem.product) {
            const itemIndex = cart.cartItems.findIndex((item: any) => item.id === cartItem.id);
            if (itemIndex >= 0) {
              cart.cartItems[itemIndex] = reloadedItem;
              this.logger.log(`✅ Reloaded cart item ${cartItem.id} with product data`);
            }
          }
        }
      } else {
        this.logger.warn(`⚠️ Added cartItem ${cartItem.id} not found in cart! Cart has ${cart.cartItems.length} items. Re-fetching cart...`);
        // Re-fetch cart to ensure we have the latest data
        const refreshedCart = await this.getCartById(tenantId, cartId);
        // Update Redis cache with fresh data
        if (this.redisService && refreshedCart.sessionId) {
          await this.redisService.setCartSession(refreshedCart.sessionId, refreshedCart);
        }
        return refreshedCart;
      }
    } else {
      this.logger.warn(`⚠️ Cart has 0 items after adding product ${productId}! Re-fetching cart...`);
      // Re-fetch cart to ensure we have the latest data
      const refreshedCart = await this.getCartById(tenantId, cartId);
      // Update Redis cache with fresh data
      if (this.redisService && refreshedCart.sessionId) {
        await this.redisService.setCartSession(refreshedCart.sessionId, refreshedCart);
      }
      return refreshedCart;
    }
    
    // Update Redis cache with fresh cart data after adding item
    if (this.redisService && cart.sessionId) {
      await this.redisService.setCartSession(cart.sessionId, cart);
      this.logger.log(`✅ Updated Redis cache with cart ${cart.id}, items: ${cart.cartItems.length}`);
    }

    return cart;
  }

  async updateCartItem(
    tenantId: string,
    cartId: string,
    itemId: string,
    quantity: number,
  ) {
    if (quantity <= 0) {
      return this.removeFromCart(tenantId, cartId, itemId);
    }

    const cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cart: { id: cartId, tenantId },
      },
      include: { 
        productVariant: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                isDigital: true,
                productCode: true,
              },
            },
          },
        },
      },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    // Check inventory if variant exists
    if (cartItem.productVariant) {
      const variant = cartItem.productVariant as any;
      const product = variant.product as any;

      const isDigitalProduct = product?.isDigital === true;
      const hasProductCode = !!product?.productCode;

      // For digital products or products with productCode, allow increasing quantity
      // even if local inventory is 0, since they can be fulfilled via supplier API.
      if (!isDigitalProduct && !hasProductCode && variant.inventoryQuantity < quantity) {
        throw new BadRequestException(`Insufficient inventory. Only ${variant.inventoryQuantity} items available.`);
      }
    }

    const updatedItem = await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
      include: { 
        product: {
          include: {
            images: { orderBy: { sortOrder: 'asc' }, take: 1 },
            categories: { select: { id: true } }
          }
        }, 
        productVariant: true 
      },
    });

    this.logger.log(`Updated cart item ${itemId} quantity to ${quantity}`);

    // Get updated cart and update Redis cache
    const updatedCart = await this.getCartById(tenantId, cartId);
    if (this.redisService && updatedCart.sessionId) {
      await this.redisService.setCartSession(updatedCart.sessionId, updatedCart);
      this.logger.log(`✅ Updated Redis cache with cart ${updatedCart.id}, items: ${updatedCart.cartItems.length}`);
    }

    return updatedCart;
  }

  async removeFromCart(tenantId: string, cartId: string, itemId: string) {
    this.logger.log(`removeFromCart called - tenantId: ${tenantId}, cartId: ${cartId}, itemId: ${itemId}`);
    
    // Clean the itemId - remove any URL encoding artifacts or extra characters
    let cleanItemId = itemId.trim();
    
    // If itemId contains slashes or plus signs, it might be incorrectly formatted
    // Try to extract the actual ID (CUIDs are typically 25 characters, no slashes)
    if (cleanItemId.includes('/') || cleanItemId.includes('+')) {
      // Split by common delimiters and find the longest valid-looking ID
      const parts = cleanItemId.split(/[/+]/);
      const validParts = parts.filter(part => {
        const trimmed = part.trim();
        return trimmed.length >= 20 && !trimmed.includes('/') && !trimmed.includes('+');
      });
      if (validParts.length > 0) {
        // Use the longest valid part
        cleanItemId = validParts.reduce((a, b) => a.length > b.length ? a : b).trim();
        this.logger.log(`Cleaned itemId from "${itemId}" to "${cleanItemId}"`);
      }
    }
    
    // First, get the cart to see what items it has
    const cart = await this.getCartById(tenantId, cartId);
    this.logger.log(`Cart has ${cart.cartItems.length} items`);
    
    if (cart.cartItems.length > 0) {
      this.logger.log(`Cart item IDs: ${cart.cartItems.map((item: any) => item.id).join(', ')}`);
    }
    
    // Try to find by exact ID first (using cleaned ID)
    let cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: cleanItemId,
        cart: { id: cartId, tenantId },
      },
    });

    // If not found by exact ID, try to find by matching the beginning of the ID
    // (in case the itemId got corrupted with extra characters)
    if (!cartItem && cleanItemId.length > 20) {
      const shortId = cleanItemId.substring(0, 25); // CUIDs are typically 25 chars
      this.logger.log(`Trying to find cart item with ID starting with: ${shortId}`);
      cartItem = await this.prisma.cartItem.findFirst({
        where: {
          id: { startsWith: shortId },
          cart: { id: cartId, tenantId },
        },
      });
    }

    // If still not found, check if itemId might be in the cart items list
    if (!cartItem) {
      const foundInCart = cart.cartItems.find((item: any) => {
        // Try exact match
        if (item.id === cleanItemId) return true;
        // Try if cleaned ID is contained in item ID
        if (item.id.includes(cleanItemId.substring(0, 20))) return true;
        // Try if item ID is contained in cleaned ID
        if (cleanItemId.includes(item.id.substring(0, 20))) return true;
        return false;
      });
      if (foundInCart) {
        this.logger.log(`Found item in cart list, using ID: ${foundInCart.id}`);
        cleanItemId = foundInCart.id;
        cartItem = await this.prisma.cartItem.findFirst({
          where: {
            id: foundInCart.id,
            cart: { id: cartId, tenantId },
          },
        });
      }
    }

    if (!cartItem) {
      // Log more details for debugging
      this.logger.warn(`Cart item not found - itemId: ${itemId}, cleaned: ${cleanItemId}, cartId: ${cartId}, tenantId: ${tenantId}`);
      this.logger.warn(`ItemId length: ${cleanItemId.length}, ItemId contains slashes: ${cleanItemId.includes('/')}, contains plus: ${cleanItemId.includes('+')}`);
      this.logger.warn(`Available cart item IDs in cart: ${cart.cartItems.map((item: any) => item.id).join(', ')}`);
      
      // If cart is empty or item doesn't exist, return the cart as-is (idempotent operation)
      // This handles the case where the item was already removed
      this.logger.log(`Item not found, but returning cart as-is (item may have been already removed)`);
      return cart;
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItem.id },
    });

    this.logger.log(`Removed cart item ${itemId} from cart ${cartId}`);

    // Get updated cart and update Redis cache
    const updatedCart = await this.getCartById(tenantId, cartId);
    if (this.redisService && updatedCart.sessionId) {
      await this.redisService.setCartSession(updatedCart.sessionId, updatedCart);
      this.logger.log(`✅ Updated Redis cache with cart ${updatedCart.id}, items: ${updatedCart.cartItems.length}`);
    }

    return updatedCart;
  }

  async clearCart(tenantId: string, cartId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { id: cartId, tenantId },
    });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    await this.prisma.cartItem.deleteMany({
      where: {
        cart: { id: cartId, tenantId },
      },
    });

    this.logger.log(`Cleared all items from cart ${cartId}`);

    // Get updated cart and update Redis cache
    const updatedCart = await this.getCartById(tenantId, cartId);
    if (this.redisService && updatedCart.sessionId) {
      await this.redisService.setCartSession(updatedCart.sessionId, updatedCart);
      this.logger.log(`✅ Updated Redis cache with cart ${updatedCart.id}, items: ${updatedCart.cartItems.length}`);
    }

    return updatedCart;
  }

  async getCartById(tenantId: string, cartId: string) {
    // Clean cartId - remove any URL encoding artifacts
    let cleanCartId = cartId.trim();
    // If cartId contains slashes or plus signs, it might be incorrectly formatted
    if (cleanCartId.includes('/') || cleanCartId.includes('+')) {
      // Try to extract the actual ID (CUIDs are typically 25 characters, no slashes)
      const parts = cleanCartId.split(/[/+]/);
      const validParts = parts.filter(part => {
        const trimmed = part.trim();
        return trimmed.length >= 20 && !trimmed.includes('/') && !trimmed.includes('+');
      });
      if (validParts.length > 0) {
        // Use the longest valid part
        cleanCartId = validParts.reduce((a, b) => a.length > b.length ? a : b).trim();
        this.logger.warn(`Cleaned cartId from "${cartId}" to "${cleanCartId}"`);
      }
    }
    
    this.logger.log(`getCartById called - tenantId: ${tenantId}, cartId: ${cleanCartId}`);
    
    const cart = await this.prisma.cart.findFirst({
      where: { id: cleanCartId, tenantId },
      include: {
        cartItems: {
          include: {
            product: {
              include: {
                images: { 
                  orderBy: { sortOrder: 'asc' },
                  take: 10 // Get more images for better product display
                },
                categories: { select: { id: true } }
              }
            },
            productVariant: {
              include: {
                product: {
                  include: {
                    images: { 
                      orderBy: { sortOrder: 'asc' },
                      take: 10
                    },
                    categories: { select: { id: true } }
                  }
                }
              }
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!cart) {
      this.logger.error(`Cart not found - tenantId: ${tenantId}, cartId: ${cartId}`);
      throw new NotFoundException('Cart not found');
    }

    // Ensure cartItems is always an array
    if (!Array.isArray(cart.cartItems)) {
      this.logger.warn(`Cart ${cartId} has non-array cartItems:`, typeof cart.cartItems);
      cart.cartItems = [];
    }

    // Validate that all cart items have valid product data
    // Instead of removing items, try to reload missing products
    const validItems: any[] = [];
    for (const item of cart.cartItems) {
      if (!item.product) {
        this.logger.warn(`Cart item ${item.id} has no product data! productId: ${item.productId}, attempting to reload...`);
        // Try to reload the product
        try {
          const product = await this.prisma.product.findFirst({
            where: { id: item.productId, tenantId },
            include: {
              images: { 
                orderBy: { sortOrder: 'asc' },
                take: 10
              },
              categories: { select: { id: true } }
            }
          });
          if (product) {
            item.product = product;
            this.logger.log(`✅ Reloaded product ${product.id} for cart item ${item.id}`);
            validItems.push(item);
          } else {
            this.logger.error(`❌ Product ${item.productId} not found! Removing cart item ${item.id}`);
            // Only remove if product truly doesn't exist
            try {
              await this.prisma.cartItem.delete({ where: { id: item.id } });
            } catch (deleteError) {
              this.logger.error(`Failed to delete invalid cart item ${item.id}:`, deleteError);
            }
          }
        } catch (reloadError) {
          this.logger.error(`Error reloading product ${item.productId}:`, reloadError);
          // Keep the item but log the error - don't remove it
          validItems.push(item);
        }
      } else {
        // Ensure product has images array
        if (!item.product.images || !Array.isArray(item.product.images)) {
          item.product.images = [];
        }
        validItems.push(item);
      }
    }
    
    // Replace cartItems with validated items
    cart.cartItems = validItems;

    this.logger.log(`getCartById returning - cartId: ${cart.id}, items: ${cart.cartItems.length}, sessionId: ${cart.sessionId}`);
    if (cart.cartItems.length > 0) {
      this.logger.log(`Cart items details (${cart.cartItems.length} items):`, cart.cartItems.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        productName: item.product?.name || item.product?.nameAr || 'Unknown',
        productNameAr: item.product?.nameAr,
        hasProduct: !!item.product,
        hasVariant: !!item.productVariant,
        variantId: item.productVariantId,
        imageCount: item.product?.images?.length || 0,
      })));
    } else {
      this.logger.warn(`⚠️ Cart ${cart.id} has 0 items!`);
    }
    
    // Update Redis cache with fresh data
    if (this.redisService && cart.sessionId) {
      await this.redisService.setCartSession(cart.sessionId, cart);
    }
    
    return cart;
  }

  /**
   * Calculate cart total with proper precision and using Tax/Shipping services
   * @param cart - Cart object with items
   * @param shippingAddress - Optional shipping address for accurate tax/shipping calculation
   */
  async calculateCartTotal(cart: any, shippingAddress?: any) {
    // Helper function to round to 2 decimal places for currency
    const roundCurrency = (value: number): number => {
      return Math.round(value * 100) / 100;
    };

    // Calculate subtotal with precision
    let subtotal = 0;
    
    for (const item of cart.cartItems) {
      const price = item.productVariant?.price || item.product.price;
      const itemTotal = Number(price) * item.quantity;
      subtotal += itemTotal;
    }
    subtotal = roundCurrency(subtotal);

    // Calculate discount
    let discountAmount = 0;
    if (cart.couponCode && this.couponService) {
      try {
        const coupon = await this.couponService.validate(cart.tenantId, cart.couponCode, subtotal);
        discountAmount = this.couponService.calculateDiscount(coupon, subtotal);
        discountAmount = roundCurrency(Math.min(discountAmount, subtotal)); // Ensure discount doesn't exceed subtotal
      } catch (error: any) {
        this.logger.warn(`Invalid coupon code ${cart.couponCode}: ${error.message}`);
      }
    }

    // Calculate shipping using ShippingService if available
    let shippingAmount = 0;
    let hasFreeShipping = false;
    
    if (cart.couponCode && this.couponService) {
      try {
        const coupon = await this.couponService.findByCode(cart.tenantId, cart.couponCode);
        if (coupon?.type === CouponType.FREE_SHIPPING) {
          hasFreeShipping = true;
        }
      } catch (error) {
        // Coupon check failed, continue with normal shipping calculation
      }
    }

    if (!hasFreeShipping && this.shippingService && shippingAddress) {
      try {
        const cartItemsForShipping = cart.cartItems.map((item: any) => ({
          price: Number(item.productVariant?.price || item.product.price),
          quantity: item.quantity,
        }));
        shippingAmount = await this.shippingService.calculateRate(
          cart.tenantId,
          shippingAddress,
          cartItemsForShipping
        );
        shippingAmount = roundCurrency(shippingAmount);
      } catch (error: any) {
        this.logger.warn(`Error calculating shipping: ${error.message}, using default`);
        // Fallback to default shipping logic
        shippingAmount = subtotal > 100 ? 0 : 10;
      }
    } else if (!hasFreeShipping) {
      // Default shipping logic when service not available
      shippingAmount = subtotal > 100 ? 0 : 10;
    }

    // Calculate tax using TaxService if available
    const taxableAmount = subtotal - discountAmount;
    let taxAmount = 0;
    
    // Check if tax is enabled in tenant settings
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: cart.tenantId },
      select: { settings: true }
    });
    const tenantSettings = (tenant?.settings || {}) as any;
    const taxes = tenantSettings.taxes || [];
    const legacyTaxEnabled = tenantSettings.taxEnabled !== false;
    
    // If no taxes array but legacy settings exist, create a temporary tax object
    if (taxes.length === 0 && legacyTaxEnabled) {
      taxes.push({
        id: 'legacy',
        name: 'Default Tax',
        rate: tenantSettings.taxRate !== undefined ? Number(tenantSettings.taxRate) : 15,
        enabled: true,
        mode: tenantSettings.taxMode || 'ALL',
        categories: tenantSettings.taxableCategories || [],
        products: tenantSettings.taxableProducts || [],
      });
    }

    if (taxes.length > 0) {
      // Calculate tax for each defined tax rule
      for (const tax of taxes) {
        if (!tax.enabled) continue;

        let taxableSubtotal = 0;

        for (const item of cart.cartItems) {
          const price = item.productVariant?.price || item.product.price;
          const itemTotal = Number(price) * item.quantity;
          
          let isTaxable = false;
          
          if (tax.mode === 'ALL') {
            isTaxable = true;
          } else if (tax.mode === 'CATEGORY') {
            const productCategoryIds = item.product.categories?.map((c: any) => c.id) || [];
            if (productCategoryIds.some((id: string) => (tax.categories || []).includes(id))) {
              isTaxable = true;
            }
          } else if (tax.mode === 'PRODUCT') {
            if ((tax.products || []).includes(item.productId)) {
              isTaxable = true;
            }
          }

          if (isTaxable) {
            taxableSubtotal += itemTotal;
          }
        }

        // Apply discount proportionally to taxable amount
        let adjustedTaxableAmount = taxableSubtotal;
        if (subtotal > 0 && discountAmount > 0) {
          const discountRatio = discountAmount / subtotal;
          adjustedTaxableAmount = taxableSubtotal * (1 - discountRatio);
        }

        // Add this tax's amount to total tax
        taxAmount += roundCurrency(adjustedTaxableAmount * (Number(tax.rate) / 100));
      }
    } else if (this.taxService && shippingAddress?.country) {
      // Fallback to location-based tax service if no custom taxes defined
      try {
        const taxResult = await this.taxService.calculateTax(
          cart.tenantId,
          taxableAmount,
          shippingAddress.country,
          shippingAddress.state
        );
        taxAmount = roundCurrency(taxResult.taxAmount);
      } catch (error: any) {
        this.logger.warn(`Error calculating tax: ${error.message}`);
      }
    }
    // If tax is disabled, taxAmount remains 0

    // Calculate final total
    const total = roundCurrency(subtotal - discountAmount + taxAmount + shippingAmount);

    return {
      subtotal,
      discount: discountAmount,
      tax: taxAmount,
      shipping: shippingAmount,
      total,
    };
  }

  async mergeCarts(tenantId: string, sessionCartId: string, userCartId: string) {
    const sessionCart = await this.getCartById(tenantId, sessionCartId);
    const userCart = await this.getCartById(tenantId, userCartId);

    // Move all items from session cart to user cart
    for (const item of sessionCart.cartItems) {
      try {
        await this.addToCart(
          tenantId,
          userCart.id,
          item.productId,
          item.quantity,
          item.productVariantId
        );
      } catch (error) {
        this.logger.warn(`Failed to merge cart item: ${error}`);
      }
    }

    // Delete session cart
    await this.prisma.cart.delete({
      where: { id: sessionCartId },
    });

    // Clear Redis cache
    if (this.redisService) {
      await this.redisService.deleteCartSession(sessionCart.sessionId);
    }

    return this.getCartById(tenantId, userCartId);
  }
}
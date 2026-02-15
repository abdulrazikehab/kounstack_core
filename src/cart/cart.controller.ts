import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
  UsePipes,
  Req,
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CartService } from './cart.service';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { ValidationPipe } from '@nestjs/common';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  private readonly logger = new Logger(CartController.name);
  
  constructor(private cartService: CartService) {}

  private getTenantId(req: any, headers: any): string {
    return req.user?.tenantId || req.tenantId || headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
  }

  private getSessionId(req: any, headers: any): string {
    // Prioritize header sessionId, then user-based sessionId, then generate a consistent one
    if (headers['x-session-id']) {
      return headers['x-session-id'];
    }
    if (req.user?.id) {
      return `user-${req.user.id}`;
    }
    // For guest users, try to get from a consistent source or generate
    // This ensures the same sessionId is used for the same guest
    const sessionId = headers['x-session-id'] || `session-${Date.now()}`;
    this.logger.log(`Generated sessionId: ${sessionId} for request`);
    return sessionId;
  }

  @Public()
  @Get()
  async getCart(
    @Request() req: any,
    @Headers() headers: any,
    @Res({ passthrough: true }) res: any
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    // DEBUG: Log to file


    this.logger.log(`Get cart - tenantId: ${tenantId}, sessionId: ${sessionId}, userId: ${userId || 'none'}`);
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    
    // Ensure session ID is returned in response header
    if (cart.sessionId) {
      res.set('X-Session-ID', cart.sessionId);
    } else if (sessionId) {
      res.set('X-Session-ID', sessionId);
    }
    
    this.logger.log(`Cart retrieved - cartId: ${cart.id}, items: ${cart.cartItems?.length || 0}, sessionId: ${cart.sessionId || sessionId}`);
    
    return cart;
  }

  @Public()
  @Post('items')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async addToCart(
    @Request() req: any,
    @Headers() headers: any,
    @Body() body: AddToCartDto,
    @Res({ passthrough: true }) res: any
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    // DEBUG: Log to file


    // SECURITY FIX: Log without sensitive data
    this.logger.log(`🛒 Adding to cart - tenantId: ${tenantId}, sessionId: ${sessionId}, userId: ${userId || 'none'}`);
    this.logger.log(`🛒 Product details - productId: "${body.productId}", quantity: ${body.quantity}, variantId: ${body.productVariantId || 'none'}`);
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    this.logger.log(`🛒 Cart found/created - cartId: ${cart.id}, existing items: ${cart.cartItems?.length || 0}`);
    
    const updatedCart = await this.cartService.addToCart(
      tenantId,
      cart.id,
      body.productId.trim(),
      body.quantity,
      body.productVariantId,
    );
    
    this.logger.log(`🛒 Cart after add - cartId: ${updatedCart.id}, items: ${updatedCart.cartItems?.length || 0}, sessionId: ${updatedCart.sessionId}`);
    
    // Ensure session ID is returned in response header
    if (updatedCart.sessionId) {
      res.set('X-Session-ID', updatedCart.sessionId);
    } else if (sessionId) {
      res.set('X-Session-ID', sessionId);
    }
    
    return updatedCart;
  }

  @Public()
  @Put('items/:itemId')
  async updateCartItem(
    @Request() req: any,
    @Headers() headers: any,
    @Param('itemId') itemId: string,
    @Body() body: UpdateCartItemDto,
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    // Decode the itemId in case it was URL encoded
    const decodedItemId = decodeURIComponent(itemId);
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    
    return await this.cartService.updateCartItem(
      tenantId,
      cart.id,
      decodedItemId,
      body.quantity,
    );
  }

  @Public()
  @Delete('items/:itemId')
  async removeFromCart(
    @Request() req: any,
    @Headers() headers: any,
    @Param('itemId') itemId: string,
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    // Decode the itemId in case it was URL encoded
    let decodedItemId = itemId;
    try {
      decodedItemId = decodeURIComponent(itemId);
    } catch (e) {
      // If decoding fails, use original
      this.logger.warn(`Failed to decode itemId: ${itemId}, using as-is`);
    }
    
    this.logger.log(`Removing cart item - original: ${itemId}, decoded: ${decodedItemId}, length: ${decodedItemId.length}`);
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    this.logger.log(`Cart ID: ${cart.id}, Cart has ${cart.cartItems?.length || 0} items`);
    
    return await this.cartService.removeFromCart(tenantId, cart.id, decodedItemId);
  }

  @Public()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearCart(
    @Request() req: any,
    @Headers() headers: any
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    
    return await this.cartService.clearCart(tenantId, cart.id);
  }

  @Post('merge')
  async mergeCarts(
    @Request() req: AuthenticatedRequest,
    @Body() body: { sessionCartId: string },
  ) {
    // This endpoint still requires auth as it merges a session cart into a user cart
    const userCart = await this.cartService.getOrCreateCart(req.tenantId, undefined, req.user.id);
    
    return await this.cartService.mergeCarts(
      req.tenantId,
      body.sessionCartId,
      userCart.id,
    );
  }

  @Public()
  @Get('total')
  async getCartTotal(
    @Request() req: any,
    @Headers() headers: any
  ) {
    const tenantId = this.getTenantId(req, headers);
    const sessionId = this.getSessionId(req, headers);
    const userId = req.user?.id;
    
    const cart = await this.cartService.getOrCreateCart(tenantId, sessionId, userId);
    const totals = await this.cartService.calculateCartTotal(cart);
    
    return {
      cartId: cart.id,
      itemsCount: cart.cartItems.length,
      ...totals,
    };
  }
}
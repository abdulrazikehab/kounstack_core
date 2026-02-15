import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { MerchantCartService } from '../services/merchant-cart.service';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AddCartItemDto, UpdateCartItemDto } from '../dto';

@Controller('merchant/cart')
@UseGuards(JwtAuthGuard)
export class MerchantCartController {
  private readonly logger = new Logger(MerchantCartController.name);

  constructor(
    private readonly cartService: MerchantCartService,
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get()
  async getCart(@Request() req: any) {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        throw new BadRequestException('User authentication required');
      }
      
      const context = await this.merchantService.validateMerchantAccess(userId);
      return this.cartService.getCart(context.merchantId, context.tenantId, context.employeeId);
    } catch (error) {
      this.logger.error(`Error getting merchant cart: ${error.message}`, error.stack);
      // Return empty cart structure if merchant access fails
      return {
        cartId: null,
        currency: 'SAR',
        items: [],
        totals: {
          subtotal: 0,
          discountTotal: 0,
          feesTotal: 0,
          taxTotal: 0,
          total: 0,
        },
      };
    }
  }

  @Post('items')
  async addItem(
    @Request() req: any,
    @Body() dto: AddCartItemDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    const cart = await this.cartService.addItem(
      context.merchantId,
      context.tenantId,
      dto,
      context.employeeId,
    );

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.CART_ITEM_ADDED,
      'CartItem',
      dto.productId,
      { productId: dto.productId, qty: dto.qty },
    );

    return cart;
  }

  @Patch('items/:itemId')
  async updateItem(
    @Request() req: any,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.cartService.updateItem(
      context.merchantId,
      context.tenantId,
      itemId,
      dto,
      context.employeeId,
    );
  }

  @Delete('items/:itemId')
  async removeItem(
    @Request() req: any,
    @Param('itemId') itemId: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    return this.cartService.removeItem(
      context.merchantId,
      context.tenantId,
      itemId,
      context.employeeId,
    );
  }

  @Post('clear')
  async clearCart(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.CART_CLEARED,
    );

    return this.cartService.clearCart(context.merchantId, context.tenantId, context.employeeId);
  }
}


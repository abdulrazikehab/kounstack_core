// apps/app-core/src/order/order.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Res,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { PDFDocument } from 'pdf-lib';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderService, CreateOrderDto, OrderResponseDto } from './order.service';
import { AuthenticatedRequest } from '../types/request.types';
import { CreateOrderRequestDto } from './dto/create-order-request.dto';
import { Public } from '../auth/public.decorator';
import { Roles } from '../decorator/roles.decorator';
import { RolesGuard } from '../guard/roles.guard';
import { UserRole } from '../types/user-role.enum';
import { CartService } from '../cart/cart.service';
import { WalletService } from '../cards/wallet.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly cartService: CartService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  private async ensureTenantId(req: AuthenticatedRequest): Promise<string> {
    const isCustomer = req.user?.role === 'CUSTOMER' || req.user?.role === 'customer';

    let tenantId = req.tenantId || req.user?.tenantId;

    // For guest checkout, try to resolve from X-Tenant-Domain header if middleware didn't set it
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      const tenantDomainHeader = req.headers['x-tenant-domain'] as string;
      if (tenantDomainHeader) {
        this.logger.log(`🔍 [OrderController] Resolving tenant from X-Tenant-Domain header: "${tenantDomainHeader}"`);
        
        // Handle localhost subdomain format (e.g., "kouncard.localhost:8080" or "kouncard.localhost")
        if (tenantDomainHeader.includes('.localhost')) {
          // Remove port if present (e.g., "kouncard.localhost:8080" -> "kouncard.localhost")
          const withoutPort = tenantDomainHeader.split(':')[0];
          // Extract subdomain (e.g., "kouncard.localhost" -> "kouncard")
          const localhostParts = withoutPort.split('.localhost');
          const subdomain = localhostParts[0];
          
          if (subdomain) {
            // Look up tenant by subdomain
            const tenant = await this.prisma.tenant.findFirst({
              where: { subdomain: subdomain },
              select: { id: true },
            });
            
            if (tenant) {
              tenantId = tenant.id;
              this.logger.log(`✅ [OrderController] Resolved tenant from subdomain "${subdomain}": ${tenantId}`);
            } else {
              // For localhost development, create the tenant if it doesn't exist
              this.logger.log(`🔍 [OrderController] Tenant not found for subdomain "${subdomain}", creating for localhost development...`);
              try {
                const newTenant = await this.prisma.tenant.create({
                  data: {
                    // Let Prisma generate UUID
                    name: `Store-${subdomain}`,
                    subdomain: subdomain,
                    plan: 'STARTER',
                    status: 'ACTIVE',
                  },
                });
                tenantId = newTenant.id;
                this.logger.log(`✅ [OrderController] Created tenant for subdomain "${subdomain}": ${tenantId}`);
              } catch (createError: any) {
                // Handle unique constraint violations - tenant might exist with different ID
                if (createError?.code === 'P2002') {
                  this.logger.log(`🔍 [OrderController] Tenant constraint conflict, finding existing tenant...`);
                  const existingTenant = await this.prisma.tenant.findUnique({
                    where: { subdomain: subdomain },
                    select: { id: true },
                  });
                  if (existingTenant) {
                    tenantId = existingTenant.id;
                    this.logger.log(`✅ [OrderController] Found existing tenant after constraint conflict: ${tenantId}`);
                  }
                } else {
                  this.logger.error(`❌ [OrderController] Failed to create tenant for subdomain "${subdomain}":`, createError?.message || createError);
                }
              }
            }
          }
        }
        // Handle production domain format (e.g., "kouncard.kounworld.com")
        else if (tenantDomainHeader.includes('.')) {
          const parts = tenantDomainHeader.split('.');
          const subdomain = parts[0];
          
          if (subdomain) {
            const tenant = await this.prisma.tenant.findFirst({
              where: { subdomain: subdomain },
              select: { id: true },
            });
            
            if (tenant) {
              tenantId = tenant.id;
              this.logger.log(`✅ [OrderController] Resolved tenant from domain subdomain "${subdomain}": ${tenantId}`);
            } else {
              this.logger.warn(`⚠️ [OrderController] Tenant not found for subdomain "${subdomain}" from production domain`);
            }
          }
        }
        // Handle plain localhost / 127.0.0.1 (with or without port) - dev and local storefront
        else {
          const domainOnly = (tenantDomainHeader || '').split(':')[0].toLowerCase();
          if (domainOnly === 'localhost' || domainOnly === '127.0.0.1') {
            const defaultTenant = process.env.DEFAULT_TENANT_ID;
            if (defaultTenant && defaultTenant !== 'default' && defaultTenant !== 'system') {
              tenantId = defaultTenant;
              this.logger.log(`✅ [OrderController] Using DEFAULT_TENANT_ID for localhost: ${tenantId}`);
            } else if (process.env.NODE_ENV !== 'production') {
              const firstTenant = await this.prisma.tenant.findFirst({
                where: { status: 'ACTIVE' },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
              });
              if (firstTenant) {
                tenantId = firstTenant.id;
                this.logger.log(`✅ [OrderController] Localhost dev fallback: using first active tenant ${tenantId}`);
              }
            }
          }
        }
      }
    }

    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      const defaultTenant = process.env.DEFAULT_TENANT_ID;
      if (defaultTenant && defaultTenant !== 'default' && defaultTenant !== 'system') {
        this.logger.warn('Tenant ID missing, using default tenant', { user: req.user, tenantId: req.tenantId });
        return defaultTenant;
      }
      
      // Log detailed information for debugging
      this.logger.error('❌ [OrderController] Tenant ID resolution failed:', {
        reqTenantId: req.tenantId,
        userTenantId: req.user?.tenantId,
        xTenantDomain: req.headers['x-tenant-domain'],
        xTenantId: req.headers['x-tenant-id'],
        host: req.headers.host,
      });
      
      throw new BadRequestException('Tenant ID is required. Please ensure you are accessing the correct store URL.');
    }
    return tenantId;
  }

  // Allow guest checkout - make endpoint public but handle auth conditionally
  @Public()
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Request() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: CreateOrderRequestDto,
  ): Promise<OrderResponseDto> {
    let tenantId: string | undefined;

    try {
      tenantId = await this.ensureTenantId(req);

      // Allow guest checkout - only require user.id if wallet balance is being used
      const rawOrderData: any = (body as any).orderData || body;
      let useWalletBalance =
        rawOrderData.useWalletBalance === true ||
        String(rawOrderData.useWalletBalance) === 'true' ||
        (body as any).useWalletBalance === true ||
        String((body as any).useWalletBalance) === 'true' ||
        String(rawOrderData.paymentMethod || (body as any).paymentMethod || '').toUpperCase() === 'WALLET_BALANCE';

      if (useWalletBalance && !((req.user as any)?.id || (req.user as any)?.userId)) {
        throw new UnauthorizedException('You must be logged in to use wallet balance for payment.');
      }

      // Support both { cartId, orderData } and direct formats
      let cartId = (body as any).cartId;

      const orderData: CreateOrderDto = {
        customerEmail: rawOrderData.customerEmail || rawOrderData.contact?.email || rawOrderData.email || (req.user as any)?.email,
        customerName:
          rawOrderData.customerName ||
          rawOrderData.shippingAddress?.fullName ||
          rawOrderData.fullName ||
          (req.user as any)?.name ||
          (req.user as any)?.firstName,
        customerPhone: rawOrderData.customerPhone || rawOrderData.contact?.phone || rawOrderData.phone,
        shippingAddress: rawOrderData.shippingAddress,
        billingAddress: rawOrderData.billingAddress || rawOrderData.shippingAddress,
        ipAddress: rawOrderData.ipAddress || req.ip || req.socket?.remoteAddress || '0.0.0.0',
        notes: rawOrderData.notes,
      };

      if (!orderData.customerEmail) throw new BadRequestException('Customer email is required.');

      // If cartId missing, try latest cart for this user in this tenant (only if logged in)
      const userId = (req.user as any)?.id || (req.user as any)?.userId;
      if (!cartId && userId) {
        const activeCart = await this.prisma.cart.findFirst({
          where: { tenantId, userId: userId },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (activeCart) cartId = activeCart.id;
      }
      
      // For guest checkout, try to get cart by sessionId
      if (!cartId && !userId) {
        const sessionId = req.headers['x-session-id'] as string;
        if (sessionId) {
          const guestCart = await this.prisma.cart.findFirst({
            where: { tenantId, sessionId, userId: null },
            orderBy: { updatedAt: 'desc' },
            select: { id: true },
          });
          if (guestCart) cartId = guestCart.id;
        }
      }

      if (!cartId) throw new BadRequestException('Cart ID is required. Please add items first.');

      // Normalize payment fields
      let paymentMethod = rawOrderData.paymentMethod || (body as any).paymentMethod;
      let paymentMethodUpper = String(paymentMethod || '').toUpperCase();

      // Re-check useWalletBalance after normalizing payment method
      useWalletBalance =
        useWalletBalance ||
        paymentMethodUpper === 'WALLET_BALANCE';

      this.logger.log(
        `💰 [OrderController] useWalletBalance=${useWalletBalance}, paymentMethod=${paymentMethodUpper}, userId=${userId || 'guest'}`,
      );

      // Load cart for total + digital check
      const cartForCheck = await this.prisma.cart.findFirst({
        where: { id: cartId, tenantId },
        include: { cartItems: { include: { product: true, productVariant: true } } },
      });

      if (!cartForCheck) throw new NotFoundException('Cart not found');
      if (!cartForCheck.cartItems?.length) throw new BadRequestException('Cart is empty');

      const cartTotal = await this.cartService.calculateCartTotal(cartForCheck as any, orderData.shippingAddress);
      const total = Number(cartTotal.total || 0);

      // detect digital/API products
      const hasInstantProducts = cartForCheck.cartItems.some((it: any) => {
        const p = it.product;
        const hasCode = !!(p?.productCode && String(p.productCode).trim() !== '');
        const isDigital = p?.isDigital === true;
        return hasCode || isDigital;
      });

      const isCOD = paymentMethodUpper.includes('CASH') || paymentMethodUpper.includes('COD');

      // ✅ HARD RULE: digital/API items cannot be COD
      if (hasInstantProducts && isCOD) {
        throw new BadRequestException('Cash on delivery is not allowed for digital products. Choose Wallet or online payment.');
      }

      const isExternal = ['VISA', 'MADA', 'APPLEPAY', 'STCPAY', 'CREDIT_CARD', 'STRIPE', 'PAYPAL', 'HYPERPAY'].some((p) =>
        paymentMethodUpper.includes(p),
      );

      // Resolve canonical wallet userId in core DB (may differ from JWT subject if user was created earlier)
      // Only do this for authenticated users (not guests)
      let walletUserId: string | undefined = undefined;
      if (req.user && typeof (req.user as any).id === 'string') {
        const rawUserId = (req.user as any).id || (req.user as any).userId;
        walletUserId = rawUserId;
        try {
          const wallet = await this.walletService.getOrCreateWallet(tenantId, rawUserId, {
            email: (req.user as any).email,
            name: (req.user as any)?.name || `${(req.user as any)?.firstName || ''} ${(req.user as any)?.lastName || ''}`.trim(),
            role: (req.user as any).role || 'CUSTOMER',
          });
          if (wallet?.userId) {
            walletUserId = wallet.userId;
          }
        } catch (e: any) {
          this.logger.warn(`Failed to resolve wallet userId for order auto-wallet check: ${e?.message || e}`);
        }

        // Auto-switch to wallet if not external and balance sufficient (only for authenticated users)
        if (!isExternal && walletUserId) {
          const hasBal = await this.walletService.hasSufficientBalance(walletUserId, total);
          if (hasBal) {
            useWalletBalance = true;
            paymentMethod = 'WALLET_BALANCE';
            paymentMethodUpper = 'WALLET_BALANCE';
          }
        }
      }

      // Extract subdomain
      let subdomain: string | undefined;
      const tenantDomainHeader = req.headers['x-tenant-domain'] as string;
      if (tenantDomainHeader) {
        const domain = tenantDomainHeader.split(':')[0];
        const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
        const secondaryDomain = process.env.PLATFORM_SECONDARY_DOMAIN || 'saeaa.net';
        
        if (domain.includes('.localhost')) subdomain = domain.split('.localhost')[0];
        else if (domain.endsWith(`.${platformDomain}`) || domain.endsWith(`.${secondaryDomain}`) || domain.endsWith('.kawn.com') || domain.endsWith('.kawn.net')) {
          const parts = domain.split('.');
          if (parts.length > 2 && parts[0] !== 'www' && parts[0] !== 'app') subdomain = parts[0];
        }
      }

      return await this.orderService.createOrder(tenantId, cartId, orderData, {
        useWalletBalance,
        paymentMethod: String(paymentMethod || ''),
        // IMPORTANT: use canonical wallet user id so balance checks and debits
        // always use the same user that owns the wallet in core DB.
        userId: walletUserId,
        serialNumberDelivery: (body as any).serialNumberDelivery,
        subdomain,
      });
    } catch (error: any) {
      this.logger.error('Error creating order:', {
        tenantId: tenantId || 'unknown',
        cartId: (body as any)?.cartId,
        userId: (req.user as any)?.id || (req.user as any)?.userId || 'guest',
        error: error?.message,
        stack: error?.stack,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }

      throw new BadRequestException(
        process.env.NODE_ENV === 'production'
          ? 'Failed to create order. Please try again.'
          : `Failed to create order: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  @Get()
  async getOrders(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = await this.ensureTenantId(req);

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const isCustomer = (req.user as any)?.role === 'CUSTOMER' || !(req.user as any)?.role || (req.user as any)?.role === 'customer';
    const customerEmail = isCustomer ? (req.user as any)?.email : undefined;
    const userId = isCustomer ? ((req.user as any)?.id || (req.user as any)?.userId) : undefined;

    return await this.orderService.getOrders(tenantId, pageNum, limitNum, status, customerEmail, userId, startDate, endDate);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getOrderStats(@Request() req: AuthenticatedRequest) {
    const tenantId = await this.ensureTenantId(req);
    return await this.orderService.getOrderStats(tenantId);
  }

  @Get('search')
  async searchOrders(
    @Request() req: AuthenticatedRequest,
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) throw new BadRequestException('Search query is required');
    const tenantId = await this.ensureTenantId(req);
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return await this.orderService.searchOrders(tenantId, query, pageNum, limitNum);
  }

  @Get(':id')
  async getOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string): Promise<OrderResponseDto> {
    const tenantId = await this.ensureTenantId(req);
    const order = await this.orderService.getOrder(tenantId, orderId);

    const isCustomer = (req.user as any)?.role === 'CUSTOMER' || (req.user as any)?.role === 'customer';
    if (isCustomer && (req.user as any)?.email) {
      const userEmail = (req.user as any).email.toLowerCase().trim();
      const orderCustomerEmail = order.customerEmail?.toLowerCase().trim();
      const orderGuestEmail = order.guestEmail?.toLowerCase().trim();
      const userId = (req.user as any)?.id || (req.user as any)?.userId;

      if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== userId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    }

    return order;
  }

  @Put(':id/status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async updateOrderStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id') orderId: string,
    @Body() body: { status: string },
  ): Promise<OrderResponseDto> {
    const tenantId = await this.ensureTenantId(req);

    const user = req.user;
    if (!user) throw new ForbiddenException('User not authenticated');

    const allowedRoles = ['SHOP_OWNER', 'STAFF', 'SUPER_ADMIN'];
    const isCustomer = user.role === 'CUSTOMER' || user.role === 'customer';
    if (isCustomer) throw new ForbiddenException('Customers cannot update order status');
    if (!allowedRoles.includes(user.role)) throw new ForbiddenException('You do not have permission to update order status');

    const status = body?.status;
    if (!status || typeof status !== 'string') throw new BadRequestException('Status is required');

    const validStatuses = [
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
      'APPROVED',
      'REJECTED',
    ];
    if (!validStatuses.includes(status)) throw new BadRequestException(`Invalid status: ${status}`);

    return await this.orderService.updateOrderStatus(tenantId, orderId, status);
  }

  @Put(':id/cancel')
  async cancelOrder(
    @Request() req: AuthenticatedRequest,
    @Param('id') orderId: string,
    @Body('reason') reason?: string,
  ): Promise<OrderResponseDto> {
    const tenantId = await this.ensureTenantId(req);

    const order = await this.orderService.getOrder(tenantId, orderId);
    const user = req.user;
    const isCustomer = user?.role === 'CUSTOMER' || user?.role === 'customer';

    if (isCustomer) {
      const userEmail = user?.email?.toLowerCase().trim();
      const orderEmail = order.customerEmail?.toLowerCase().trim();
      const guestEmail = order.guestEmail?.toLowerCase().trim();
      if (userEmail !== orderEmail && guestEmail !== userEmail) {
        throw new ForbiddenException('You can only cancel your own orders');
      }
      if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
        throw new BadRequestException('Only pending or confirmed orders can be cancelled');
      }
    } else {
      const allowedRoles = ['SHOP_OWNER', 'STAFF', 'SUPER_ADMIN'];
      if (!allowedRoles.includes(user?.role as any)) {
        throw new ForbiddenException('You do not have permission to cancel orders');
      }
    }

    return await this.orderService.cancelOrder(tenantId, orderId, reason);
  }

  @Put(':id/reject')
  @Roles(UserRole.SHOP_OWNER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async rejectOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string, @Body('reason') reason?: string) {
    const tenantId = await this.ensureTenantId(req);
    return await this.orderService.rejectOrder(tenantId, orderId, reason);
  }

  @Put(':id/refund')
  @Roles(UserRole.SHOP_OWNER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async refundOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string, @Body('reason') reason?: string) {
    const tenantId = await this.ensureTenantId(req);
    return await this.orderService.refundOrder(tenantId, orderId, reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string): Promise<void> {
    const tenantId = await this.ensureTenantId(req);

    const user = req.user;
    const isCustomer = user?.role === 'CUSTOMER' || user?.role === 'customer';

    const order = await this.orderService.getOrder(tenantId, orderId);

    if (isCustomer) {
      const userEmail = user?.email?.toLowerCase().trim();
      const orderEmail = order.customerEmail?.toLowerCase().trim();
      const guestEmail = order.guestEmail?.toLowerCase().trim();
      if (userEmail !== orderEmail && guestEmail !== userEmail) {
        throw new ForbiddenException('You can only delete your own orders');
      }
    } else {
      const allowedRoles = ['SHOP_OWNER', 'STAFF', 'SUPER_ADMIN'];
      if (!allowedRoles.includes(user?.role as any)) throw new ForbiddenException('You do not have permission to delete orders');
    }

    if (order.status !== 'CANCELLED') throw new BadRequestException('Only cancelled orders can be deleted');
    // implement hard delete if needed
  }

  @Post(':id/retry-delivery')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async retryDigitalCardsDelivery(@Request() req: AuthenticatedRequest, @Param('id') orderId: string) {
    const tenantId = await this.ensureTenantId(req);
    const order = await this.orderService.getOrder(tenantId, orderId);

    // ✅ HARD RULE: must be paid
    const paymentStatus = String(order.paymentStatus || '').toUpperCase();
    if (paymentStatus !== 'SUCCEEDED') {
      throw new BadRequestException('Order is not paid yet. Please complete payment first.');
    }

    const user = req.user;
    const allowedRoles = ['SHOP_OWNER', 'STAFF', 'SUPER_ADMIN'];
    const isAdminOrMerchant = user?.role && allowedRoles.includes(user.role);
    const isCustomer = user?.role === 'CUSTOMER' || user?.role === 'customer';

    if (!isAdminOrMerchant) {
      if (isCustomer && user?.email) {
        const userEmail = user.email.toLowerCase().trim();
        const orderCustomerEmail = order.customerEmail?.toLowerCase().trim();
        const orderGuestEmail = order.guestEmail?.toLowerCase().trim();

        const userUserId = (user as any)?.id || (user as any)?.userId;
        if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== userUserId) {
          throw new ForbiddenException('You can only retry delivery for your own orders');
        }
      } else if (!isCustomer) {
        throw new ForbiddenException('You do not have permission to retry delivery');
      }
    }

    this.logger.log(`🔄 Retrying digital cards delivery for order ${orderId}`);
    await this.orderService.processDigitalCardsDeliveryAfterPayment(orderId);
    return await this.orderService.getOrder(tenantId, orderId);
  }

  @Get(':id/download/:fileType')
  async downloadDeliveryFile(
    @Request() req: AuthenticatedRequest,
    @Param('id') orderId: string,
    @Param('fileType') fileType: string,
    @Res() res: Response,
  ) {
    const tenantId = await this.ensureTenantId(req);

    const allowedFileTypes = ['excel', 'text', 'pdf'];
    if (!allowedFileTypes.includes(fileType)) {
      throw new BadRequestException(`Invalid file type. Allowed: ${allowedFileTypes.join(', ')}`);
    }

    const order = await this.orderService.getOrder(tenantId, orderId);

    const isCustomer = (req.user as any)?.role === 'CUSTOMER' || (req.user as any)?.role === 'customer';
    if (isCustomer && (req.user as any)?.email) {
      const userEmail = (req.user as any).email.toLowerCase().trim();
      const orderCustomerEmail = order.customerEmail?.toLowerCase().trim();
      const orderGuestEmail = order.guestEmail?.toLowerCase().trim();
      const userUserId = (req.user as any)?.id || (req.user as any)?.userId;
      if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== userUserId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    }

    return this.serveDeliveryFile(tenantId, orderId, fileType, res);
  }

  private validateDownloadToken(orderId: string, fileType: string, token: string): boolean {
    const secret = process.env.JWT_SECRET || 'fallback-secret';
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${orderId}:${fileType}`);
    return token === hmac.digest('hex');
  }

  private async serveDeliveryFile(tenantId: string, orderId: string, fileType: string, res: Response) {
    const allowedFileTypes = ['excel', 'text', 'pdf'];
    if (!allowedFileTypes.includes(fileType)) {
      throw new BadRequestException(`Invalid file type. Allowed types: ${allowedFileTypes.join(', ')}`);
    }

    const orderWithFiles = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { deliveryFiles: true, orderNumber: true },
    });

    if (!orderWithFiles) throw new NotFoundException('Order not found');

    const deliveryFiles = await (this.orderService as any).digitalCardsDeliveryService.getDeliveryFiles(orderId);
    let filePath: string | undefined = fileType === 'excel' ? deliveryFiles?.excelFileUrl : deliveryFiles?.textFileUrl;

    // Generate on-the-fly if no file but serial numbers exist
    if (!filePath && orderWithFiles.deliveryFiles && typeof orderWithFiles.deliveryFiles === 'object') {
      const df = orderWithFiles.deliveryFiles as any;
      const serialNumbers = df.serialNumbers || [];
      const serialNumbersByProduct = df.serialNumbersByProduct || {};
      const hasSerialNumbers = serialNumbers.length > 0 || Object.keys(serialNumbersByProduct).length > 0;

      if (hasSerialNumbers) {
        if (fileType === 'text') {
          const all: Array<{ serialNumber: string; pin?: string }> = [];
          Object.values(serialNumbersByProduct).forEach((arr: any) => {
            if (Array.isArray(arr)) {
              arr.forEach((sn: any) => {
                const serial = sn.serialNumber || sn.cardCode || '';
                const pin = sn.pin || sn.cardPin || '';
                if (serial) all.push({ serialNumber: serial, pin });
              });
            }
          });

          if (all.length === 0 && Array.isArray(df.serialNumbers)) {
            df.serialNumbers.forEach((sn: string) => sn && all.push({ serialNumber: sn, pin: '' }));
          }

          const content = all.map((c) => `${c.serialNumber}\t${c.pin || ''}`).join('\n');
          res.setHeader('Content-Type', 'text/plain');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="order-${orderWithFiles.orderNumber || orderId}-serial-numbers.txt"`,
          );
          return res.send(content);
        }

        if (fileType === 'excel') {
          const all: Array<{ productName?: string; serialNumber: string; pin?: string }> = [];
          Object.entries(serialNumbersByProduct).forEach(([productName, arr]: [string, any]) => {
            if (Array.isArray(arr)) {
              arr.forEach((sn: any) => {
                const serial = sn.serialNumber || sn.cardCode || '';
                const pin = sn.pin || sn.cardPin || '';
                if (serial) all.push({ productName, serialNumber: serial, pin });
              });
            }
          });

          if (all.length === 0 && Array.isArray(df.serialNumbers)) {
            df.serialNumbers.forEach((sn: string) => sn && all.push({ serialNumber: sn, pin: '' }));
          }

          if (!all.length) throw new BadRequestException('No serial numbers available to generate Excel file');

          const wb = xlsx.utils.book_new();
          const rows = [
            ['Product Name', 'Serial Number', 'PIN'],
            ...all.map((c) => [c.productName || '', c.serialNumber || '', c.pin || '']),
          ];
          const ws = xlsx.utils.aoa_to_sheet(rows);
          xlsx.utils.book_append_sheet(wb, ws, 'Serial Numbers');

          const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="order-${orderWithFiles.orderNumber || orderId}-serial-numbers.xlsx"`,
          );
          return res.send(buf);
        }

        if (fileType === 'pdf') {
          return this.generatePdfOnTheFly(orderWithFiles, df, res);
        }
      }
    }

    if (!filePath) {
      throw new NotFoundException(`${fileType} file not found for this order. Serial numbers may not be available yet.`);
    }

    const normalizedPath = filePath.replace(/^\//, '').replace(/\\/g, '/');
    if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
      throw new BadRequestException('Invalid file path');
    }

    const allowedBaseDir = path.join(process.cwd(), 'uploads', 'digital-cards', tenantId);
    const fullPath = path.join(allowedBaseDir, path.basename(normalizedPath));

    const resolvedPath = path.resolve(fullPath);
    const allowedPath = path.resolve(allowedBaseDir);
    if (!resolvedPath.startsWith(allowedPath)) throw new ForbiddenException('Invalid file path');

    if (!fs.existsSync(fullPath)) throw new NotFoundException('File not found on server');

    const stream = fs.createReadStream(fullPath);
    res.setHeader(
      'Content-Type',
      fileType === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/plain',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`);
    stream.pipe(res);
  }

  @Public()
  @Get(':id/public/download/:fileType')
  async downloadDeliveryFilePublic(
    @Param('id') orderId: string,
    @Param('fileType') fileType: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) throw new ForbiddenException('Download token is required');
    if (!this.validateDownloadToken(orderId, fileType, token)) throw new ForbiddenException('Invalid download token');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { tenantId: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    return this.serveDeliveryFile(order.tenantId, orderId, fileType, res);
  }

  private async generatePdfOnTheFly(order: any, df: any, res: Response) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { height } = page.getSize();
    let y = height - 50;

    const serialNumbersByProduct = df.serialNumbersByProduct || {};
    const serialNumbers = df.serialNumbers || [];
    const orderNumber = order.orderNumber || order.id;

    page.drawText(`Order Serial Numbers: ${orderNumber}`, { x: 50, y, size: 20 });
    y -= 40;

    const all: Array<{ productName?: string; serialNumber: string; pin?: string }> = [];
    Object.entries(serialNumbersByProduct).forEach(([productName, arr]: [string, any]) => {
      if (Array.isArray(arr)) {
        arr.forEach((sn: any) => {
          const serial = sn.serialNumber || sn.cardCode || '';
          const pin = sn.pin || sn.cardPin || '';
          if (serial) all.push({ productName, serialNumber: serial, pin });
        });
      }
    });

    if (all.length === 0 && Array.isArray(serialNumbers)) {
      serialNumbers.forEach((sn: string) => sn && all.push({ serialNumber: sn, pin: '' }));
    }

    all.forEach((c) => {
      if (y < 40) {
        const newPage = pdfDoc.addPage();
        y = newPage.getHeight() - 50;
      }
      const text = `${c.productName ? c.productName + ': ' : ''}SN: ${c.serialNumber}${c.pin ? ' | PIN: ' + c.pin : ''}`;
      page.drawText(text, { x: 50, y, size: 10 });
      y -= 15;
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="order-${orderNumber}-serial-numbers.pdf"`);
    res.send(Buffer.from(pdfBytes));
  }
}

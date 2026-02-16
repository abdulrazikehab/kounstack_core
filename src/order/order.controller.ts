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

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly cartService: CartService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  private ensureTenantId(req: AuthenticatedRequest): string {
    const isCustomer = req.user?.role === 'CUSTOMER' || req.user?.role === 'customer';

    let tenantId = req.tenantId || req.user?.tenantId;

    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      const defaultTenant = process.env.DEFAULT_TENANT_ID;
      if (defaultTenant && defaultTenant !== 'default' && defaultTenant !== 'system') {
        this.logger.warn('Tenant ID missing, using default tenant', { user: req.user, tenantId: req.tenantId });
        return defaultTenant;
      }
      throw new BadRequestException('Tenant ID is required.');
    }
    return tenantId;
  }

  // ✅ IMPORTANT FIX: createOrder MUST NOT be @Public
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
      tenantId = this.ensureTenantId(req);

      if (!req.user?.id) {
        throw new UnauthorizedException('You must be logged in to create an order.');
      }

      // Support both { cartId, orderData } and direct formats
      const rawOrderData: any = (body as any).orderData || body;

      let cartId = (body as any).cartId;

      const orderData: CreateOrderDto = {
        customerEmail: rawOrderData.customerEmail || rawOrderData.contact?.email || rawOrderData.email || req.user.email,
        customerName:
          rawOrderData.customerName ||
          rawOrderData.shippingAddress?.fullName ||
          rawOrderData.fullName ||
          req.user.name,
        customerPhone: rawOrderData.customerPhone || rawOrderData.contact?.phone || rawOrderData.phone,
        shippingAddress: rawOrderData.shippingAddress,
        billingAddress: rawOrderData.billingAddress || rawOrderData.shippingAddress,
        ipAddress: rawOrderData.ipAddress || req.ip || req.socket?.remoteAddress || '0.0.0.0',
        notes: rawOrderData.notes,
      };

      if (!orderData.customerEmail) throw new BadRequestException('Customer email is required.');

      // If cartId missing, try latest cart for this user in this tenant
      if (!cartId) {
        const activeCart = await this.prisma.cart.findFirst({
          where: { tenantId, userId: req.user.id },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (activeCart) cartId = activeCart.id;
      }

      if (!cartId) throw new BadRequestException('Cart ID is required. Please add items first.');

      // Normalize payment fields
      let paymentMethod = rawOrderData.paymentMethod || (body as any).paymentMethod;
      let paymentMethodUpper = String(paymentMethod || '').toUpperCase();

      let useWalletBalance =
        rawOrderData.useWalletBalance === true ||
        String(rawOrderData.useWalletBalance) === 'true' ||
        (body as any).useWalletBalance === true ||
        String((body as any).useWalletBalance) === 'true' ||
        paymentMethodUpper === 'WALLET_BALANCE';

      this.logger.log(
        `💰 [OrderController] initial useWalletBalance=${useWalletBalance}, paymentMethod=${paymentMethodUpper}, userId=${req.user.id}`,
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
      const hasInstantProducts = cartForCheck.cartItems.some((it) => {
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
      const rawUserId = req.user.id;
      let walletUserId = rawUserId;
      try {
        const wallet = await this.walletService.getOrCreateWallet(tenantId, rawUserId, {
          email: req.user.email,
          name: (req.user as any)?.name || `${(req.user as any)?.firstName || ''} ${(req.user as any)?.lastName || ''}`.trim(),
          role: req.user.role || 'CUSTOMER',
        });
        if (wallet?.userId) {
          walletUserId = wallet.userId;
        }
      } catch (e: any) {
        this.logger.warn(`Failed to resolve wallet userId for order auto-wallet check: ${e?.message || e}`);
      }

      // Auto-switch to wallet if not external and balance sufficient
      if (!isExternal) {
        const hasBal = await this.walletService.hasSufficientBalance(walletUserId, total);
        if (hasBal) {
          useWalletBalance = true;
          paymentMethod = 'WALLET_BALANCE';
          paymentMethodUpper = 'WALLET_BALANCE';
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
        userId: req.user?.id,
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
    const tenantId = this.ensureTenantId(req);

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const isCustomer = req.user?.role === 'CUSTOMER' || !req.user?.role || req.user?.role === 'customer';
    const customerEmail = isCustomer ? req.user?.email : undefined;
    const userId = isCustomer ? req.user?.id : undefined;

    return await this.orderService.getOrders(tenantId, pageNum, limitNum, status, customerEmail, userId, startDate, endDate);
  }

  @Get('stats')
  async getOrderStats(@Request() req: AuthenticatedRequest) {
    const tenantId = this.ensureTenantId(req);
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
    const tenantId = this.ensureTenantId(req);
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return await this.orderService.searchOrders(tenantId, query, pageNum, limitNum);
  }

  @Get(':id')
  async getOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string): Promise<OrderResponseDto> {
    const tenantId = this.ensureTenantId(req);
    const order = await this.orderService.getOrder(tenantId, orderId);

    const isCustomer = req.user?.role === 'CUSTOMER' || req.user?.role === 'customer';
    if (isCustomer && req.user?.email) {
      const userEmail = req.user.email.toLowerCase().trim();
      const orderCustomerEmail = order.customerEmail?.toLowerCase().trim();
      const orderGuestEmail = order.guestEmail?.toLowerCase().trim();

      if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== req.user.id) {
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
    const tenantId = this.ensureTenantId(req);

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
    const tenantId = this.ensureTenantId(req);

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
    const tenantId = this.ensureTenantId(req);
    return await this.orderService.rejectOrder(tenantId, orderId, reason);
  }

  @Put(':id/refund')
  @Roles(UserRole.SHOP_OWNER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async refundOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string, @Body('reason') reason?: string) {
    const tenantId = this.ensureTenantId(req);
    return await this.orderService.refundOrder(tenantId, orderId, reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOrder(@Request() req: AuthenticatedRequest, @Param('id') orderId: string): Promise<void> {
    const tenantId = this.ensureTenantId(req);

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
    const tenantId = this.ensureTenantId(req);
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

        if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== user.id) {
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
    const tenantId = this.ensureTenantId(req);

    const allowedFileTypes = ['excel', 'text', 'pdf'];
    if (!allowedFileTypes.includes(fileType)) {
      throw new BadRequestException(`Invalid file type. Allowed: ${allowedFileTypes.join(', ')}`);
    }

    const order = await this.orderService.getOrder(tenantId, orderId);

    const isCustomer = req.user?.role === 'CUSTOMER' || req.user?.role === 'customer';
    if (isCustomer && req.user?.email) {
      const userEmail = req.user.email.toLowerCase().trim();
      const orderCustomerEmail = order.customerEmail?.toLowerCase().trim();
      const orderGuestEmail = order.guestEmail?.toLowerCase().trim();
      if (orderCustomerEmail !== userEmail && orderGuestEmail !== userEmail && order.userId !== req.user.id) {
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

import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../cards/wallet.service';
import { CardInventoryService } from '../../cards/card-inventory.service';
import { CardProductService } from '../../cards/card-product.service';
import { MerchantCartService } from './merchant-cart.service';
import { InvoiceService } from './invoice.service';
import { MerchantNotificationService } from './merchant-notification.service';
import {
  CreateOrderFromCartDto,
  CreateQuickRechargeOrderDto,
  ReorderDto,
  CancelOrderDto,
  SubmitBankTransferProofDto,
  OrderListQuery,
} from '../dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class MerchantOrderService {
  private readonly logger = new Logger(MerchantOrderService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private cardInventoryService: CardInventoryService,
    private cardProductService: CardProductService,
    private cartService: MerchantCartService,
    private invoiceService: InvoiceService,
    private notificationService: MerchantNotificationService,
  ) {}

  // Generate order number
  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomInt(0, 1000000).toString(36).substring(0, 4).toUpperCase();
    return `MO-${timestamp}-${random}`;
  }

  // Create order from cart
  async createFromCart(
    merchantId: string,
    tenantId: string,
    userId: string,
    dto: CreateOrderFromCartDto,
    employeeId?: string,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    // Check idempotency
    if (idempotencyKey) {
      const existing = await this.prisma.merchantOrder.findUnique({
        where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
      });
      if (existing) {
        return this.getOrder(merchantId, existing.id);
      }
    }

    // Get cart with items
    const cart = await this.cartService.getCartItemsForOrder(dto.cartId, tenantId);

    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate cart belongs to merchant
    if (cart.merchantId !== merchantId) {
      throw new BadRequestException('Cart does not belong to merchant');
    }

    // Calculate totals and validate
    let subtotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    let profitTotal = new Decimal(0);
    const orderItems: any[] = [];

    for (const item of cart.items) {
      const product = item.product;

      if (!product.isAvailable) {
        throw new BadRequestException(`Product ${product.name} is not available`);
      }

      const minQty = product.min || 1;
      const maxQty = product.max || 1000;

      if (item.quantity < minQty || item.quantity > maxQty) {
        throw new BadRequestException(
          `Quantity for ${product.name} must be between ${minQty} and ${maxQty}`,
        );
      }

      if (product.stockCount < item.quantity) {
        throw new BadRequestException(`Only ${product.stockCount} available for ${product.name}`);
      }

      const unitPrice = new Decimal(product.costPerItem || product.price);
      const unitCost = new Decimal(product.costPerItem || product.price).times(0.85); // Example cost calculation
      const lineSubtotal = unitPrice.times(item.quantity);
      const taxRate = 0.15;
      const lineTax = lineSubtotal.times(taxRate);
      const lineTotal = lineSubtotal.plus(lineTax);
      const lineProfit = lineSubtotal.minus(unitCost.times(item.quantity));


      subtotal = subtotal.plus(lineSubtotal);
      taxTotal = taxTotal.plus(lineTax);
      profitTotal = profitTotal.plus(lineProfit);

      orderItems.push({
        productId: product.id,
        productNameSnapshotEn: product.name,
        productNameSnapshotAr: product.nameAr,
        quantity: item.quantity,
        unitPrice: unitPrice.toNumber(),
        unitCost: unitCost.toNumber(),
        lineSubtotal: lineSubtotal.toNumber(),
        lineDiscount: 0,
        lineTotal: lineTotal.toNumber(),
        lineProfit: lineProfit.toNumber(),
        metadata: item.metadata,
      });
    }

    const total = subtotal.plus(taxTotal);
    const orderNumber = this.generateOrderNumber();

    // Handle payment
    if (dto.paymentMethod === 'wallet') {
      return this.createWalletOrder(
        merchantId, tenantId, userId, orderNumber, dto.playerId || null,
        employeeId, orderItems, subtotal, taxTotal, total, profitTotal,
        idempotencyKey, ipAddress, userAgent, cart.id
      );
    } else {
      return this.createBankTransferOrder(
        merchantId, tenantId, userId, orderNumber, dto.playerId || null,
        employeeId, orderItems, subtotal, taxTotal, total, profitTotal,
        idempotencyKey, ipAddress, userAgent, cart.id
      );
    }
  }

  // Create wallet-paid order
  private async createWalletOrder(
    merchantId: string, tenantId: string, userId: string, orderNumber: string,
    playerId: string | null, employeeId: string | undefined, orderItems: any[],
    subtotal: Decimal, taxTotal: Decimal, total: Decimal, profitTotal: Decimal,
    idempotencyKey?: string, ipAddress?: string, userAgent?: string, cartId?: string
  ) {
    // Check wallet balance
    const hasFunds = await this.walletService.hasSufficientBalance(userId, total.toNumber());
    if (!hasFunds) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    // Create order in transaction
    const result = await this.prisma.$transaction(async (tx: any) => {
      // Create order
      const order = await tx.merchantOrder.create({
        data: {
          merchantId,
          employeeId,
          playerId,
          orderNumber,
          source: 'CART',
          status: 'PENDING',
          paymentMethod: 'WALLET',
          paymentStatus: 'PENDING',
          currency: 'SAR',
          subtotal: subtotal.toNumber(),
          discountTotal: 0,
          feesTotal: 0,
          taxTotal: taxTotal.toNumber(),
          total: total.toNumber(),
          profitTotal: profitTotal.toNumber(),
          idempotencyKey,
          ipAddress,
          userAgent,
          submittedAt: new Date(),
        },
      });

      // Create order items
      for (const item of orderItems) {
        await tx.merchantOrderItem.create({
          data: { orderId: order.id, ...item },
        });
      }

      // Create order event
      await tx.merchantOrderEvent.create({
        data: {
          orderId: order.id,
          type: 'CREATED',
          toStatus: 'PENDING',
          message: 'Order created',
          actorType: employeeId ? 'EMPLOYEE' : 'MERCHANT',
        },
      });

      // Debit wallet
      await this.walletService.debit(
        userId, total.toNumber(),
        `Order ${orderNumber}`, `طلب رقم ${orderNumber}`,
        order.id
      );

      // Update order to processing
      const updatedOrder = await tx.merchantOrder.update({
        where: { id: order.id },
        data: {
          status: 'PROCESSING',
          paymentStatus: 'PAID',
        },
      });

      await tx.merchantOrderEvent.create({
        data: {
          orderId: order.id,
          type: 'STATUS_CHANGED',
          fromStatus: 'PENDING',
          toStatus: 'PROCESSING',
          message: 'Payment received, processing order',
          actorType: 'SYSTEM',
        },
      });

      return updatedOrder;
    });

    // Process delivery and clear cart
    await this.processDelivery(result.id, userId);
    if (cartId) {
      await this.prisma.merchantCartItem.deleteMany({ where: { cartId } });
    }

    return this.getOrder(merchantId, result.id);
  }

  // Create bank transfer order
  private async createBankTransferOrder(
    merchantId: string, tenantId: string, userId: string, orderNumber: string,
    playerId: string | null, employeeId: string | undefined, orderItems: any[],
    subtotal: Decimal, taxTotal: Decimal, total: Decimal, profitTotal: Decimal,
    idempotencyKey?: string, ipAddress?: string, userAgent?: string, cartId?: string
  ) {
    // Get bank account for transfers
    const bank = await this.prisma.bank.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (!bank) {
      throw new BadRequestException('No bank account configured for transfers');
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      // Create order
      const order = await tx.merchantOrder.create({
        data: {
          merchantId,
          employeeId,
          playerId,
          orderNumber,
          source: 'CART',
          status: 'PENDING',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'UNPAID',
          currency: 'SAR',
          subtotal: subtotal.toNumber(),
          discountTotal: 0,
          feesTotal: 0,
          taxTotal: taxTotal.toNumber(),
          total: total.toNumber(),
          profitTotal: profitTotal.toNumber(),
          idempotencyKey,
          ipAddress,
          userAgent,
        },
      });

      // Create order items
      for (const item of orderItems) {
        await tx.merchantOrderItem.create({
          data: { orderId: order.id, ...item },
        });
      }

      // Create payment intent
      await tx.paymentIntent.create({
        data: {
          merchantId,
          orderId: order.id,
          method: 'BANK_TRANSFER',
          status: 'REQUIRES_ACTION',
          amount: total.toNumber(),
          currency: 'SAR',
          bankAccountId: bank.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Create order event
      await tx.merchantOrderEvent.create({
        data: {
          orderId: order.id,
          type: 'CREATED',
          toStatus: 'PENDING',
          message: 'Order created - awaiting bank transfer',
          actorType: employeeId ? 'EMPLOYEE' : 'MERCHANT',
        },
      });

      return order;
    });

    // Clear cart
    if (cartId) {
      await this.prisma.merchantCartItem.deleteMany({ where: { cartId } });
    }

    return this.getOrder(merchantId, result.id);
  }

  // Process delivery for completed order
  private async processDelivery(orderId: string, userId: string) {
    const order = await this.prisma.merchantOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) return;

    // Reserve and mark cards as sold for each item
    for (const item of order.items) {
      try {
        // Reserve cards
        const cardIds = await this.cardInventoryService.reserveCards(
          item.productId, item.quantity, orderId
        );

        // Mark as sold
        await this.cardInventoryService.markAsSold(cardIds, userId, orderId);

        // Get card details for delivery
        const cards = await this.prisma.cardInventory.findMany({
          where: { id: { in: cardIds } },
        });

        // Create deliveries
        for (const card of cards) {
          await this.prisma.merchantOrderDelivery.create({
            data: {
              orderItemId: item.id,
              cardCode: card.cardCode,
              cardPin: card.cardPin,
            },
          });
        }

        // Update stock
        await this.cardProductService.updateStockCount(item.productId);
      } catch (error) {
        this.logger.error(`Failed to process delivery for item ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Update order to completed
    await this.prisma.merchantOrder.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await this.prisma.merchantOrderEvent.create({
      data: {
        orderId,
        type: 'STATUS_CHANGED',
        fromStatus: 'PROCESSING',
        toStatus: 'COMPLETED',
        message: 'Order completed and cards delivered',
        actorType: 'SYSTEM',
      },
    });

    // Generate invoice
    await this.invoiceService.createForOrder(orderId);
  }

  // Get single order
  async getOrder(merchantId: string, orderId: string) {
    const order = await this.prisma.merchantOrder.findFirst({
      where: { id: orderId, merchantId },
      include: {
        items: {
          include: {
            product: { select: { name: true, nameAr: true, image: true } },
            deliveries: true,
          },
        },
        events: { orderBy: { createdAt: 'desc' } },
        paymentIntents: {
          include: {
            bankAccount: true,
          },
        },
        player: true,
        invoice: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrderResponse(order);
  }

  // Get orders list
  async getOrders(merchantId: string, query: OrderListQuery) {
    const limit = query.limit ? Number(query.limit) : 20;
    const where: any = { merchantId };

    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.playerId) where.playerId = query.playerId;

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    if (query.q) {
      where.OR = [
        { orderNumber: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const cursorOptions: any = {};
    if (query.cursor) {
      cursorOptions.cursor = { id: query.cursor };
      cursorOptions.skip = 1;
    }

    const orders = await this.prisma.merchantOrder.findMany({
      where,
      include: {
        items: { select: { id: true } },
        player: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...cursorOptions,
    });

    const hasMore = orders.length > limit;
    const items = hasMore ? orders.slice(0, limit) : orders;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        source: o.source,
        total: Number(o.total),
        currency: o.currency,
        itemsCount: o.items.length,
        playerName: o.player?.name,
        createdAt: o.createdAt,
        completedAt: o.completedAt,
      })),
      nextCursor,
    };
  }

  // Reorder from existing order
  async reorder(merchantId: string, tenantId: string, userId: string, orderId: string, dto: ReorderDto, employeeId?: string) {
    const original = await this.prisma.merchantOrder.findFirst({
      where: { id: orderId, merchantId, status: 'COMPLETED' },
      include: { items: true },
    });

    if (!original) {
      throw new NotFoundException('Original order not found or not completed');
    }

    // Create new order items from original
    const orderItems: any[] = [];
    let subtotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    let profitTotal = new Decimal(0);

    for (const item of original.items) {
      const product = await this.cardProductService.findOne(tenantId, item.productId);

      if (!product.isAvailable) {
        throw new BadRequestException(`Product ${product.name} is no longer available`);
      }

      if (product.availableStock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for ${product.name}`);
      }

      const unitPrice = dto.useLatestPrices !== false
        ? new Decimal(product.wholesalePrice)
        : new Decimal(item.unitPrice);
      const unitCost = new Decimal(product.wholesalePrice).times(0.85);
      const lineSubtotal = unitPrice.times(item.quantity);
      const taxRate = 0.15;
      const lineTax = lineSubtotal.times(taxRate);
      const lineTotal = lineSubtotal.plus(lineTax);
      const lineProfit = lineSubtotal.minus(unitCost.times(item.quantity));


      subtotal = subtotal.plus(lineSubtotal);
      taxTotal = taxTotal.plus(lineTax);
      profitTotal = profitTotal.plus(lineProfit);

      orderItems.push({
        productId: item.productId,
        productNameSnapshotEn: product.name,
        productNameSnapshotAr: product.nameAr,
        quantity: item.quantity,
        unitPrice: unitPrice.toNumber(),
        unitCost: unitCost.toNumber(),
        lineSubtotal: lineSubtotal.toNumber(),
        lineDiscount: 0,
        lineTotal: lineTotal.toNumber(),
        lineProfit: lineProfit.toNumber(),
        metadata: item.metadata,
      });
    }

    const total = subtotal.plus(taxTotal);
    const orderNumber = this.generateOrderNumber();
    const playerId = dto.playerId || original.playerId;

    if (dto.paymentMethod === 'wallet') {
      const hasFunds = await this.walletService.hasSufficientBalance(userId, total.toNumber());
      if (!hasFunds) {
        throw new BadRequestException('Insufficient wallet balance');
      }
    }

    // Create order
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.merchantOrder.create({
        data: {
          merchantId,
          employeeId,
          playerId,
          orderNumber,
          source: 'REORDER',
          originalOrderId: orderId,
          status: dto.paymentMethod === 'wallet' ? 'PENDING' : 'PENDING',
          paymentMethod: dto.paymentMethod === 'wallet' ? 'WALLET' : 'BANK_TRANSFER',
          paymentStatus: dto.paymentMethod === 'wallet' ? 'PENDING' : 'UNPAID',
          currency: 'SAR',
          subtotal: subtotal.toNumber(),
          discountTotal: 0,
          feesTotal: 0,
          taxTotal: taxTotal.toNumber(),
          total: total.toNumber(),
          profitTotal: profitTotal.toNumber(),
          submittedAt: new Date(),
        },
      });

      for (const item of orderItems) {
        await tx.merchantOrderItem.create({
          data: { orderId: order.id, ...item },
        });
      }

      await tx.merchantOrderEvent.create({
        data: {
          orderId: order.id,
          type: 'CREATED',
          toStatus: 'PENDING',
          message: `Reorder from ${original.orderNumber}`,
          actorType: employeeId ? 'EMPLOYEE' : 'MERCHANT',
        },
      });

      return order;
    });

    // Process wallet payment if applicable
    if (dto.paymentMethod === 'wallet') {
      await this.walletService.debit(
        userId, total.toNumber(),
        `Order ${orderNumber}`, `طلب رقم ${orderNumber}`,
        result.id
      );

      await this.prisma.merchantOrder.update({
        where: { id: result.id },
        data: { status: 'PROCESSING', paymentStatus: 'PAID' },
      });

      await this.processDelivery(result.id, userId);
    } else {
      // Create payment intent for bank transfer
      const bank = await this.prisma.bank.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });

      if (bank) {
        await this.prisma.paymentIntent.create({
          data: {
            merchantId,
            orderId: result.id,
            method: 'BANK_TRANSFER',
            status: 'REQUIRES_ACTION',
            amount: total.toNumber(),
            currency: 'SAR',
            bankAccountId: bank.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }
    }

    return this.getOrder(merchantId, result.id);
  }

  // Cancel order
  async cancelOrder(merchantId: string, userId: string, orderId: string, dto: CancelOrderDto) {
    const order = await this.prisma.merchantOrder.findFirst({
      where: { id: orderId, merchantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!['PENDING', 'DRAFT'].includes(order.status)) {
      throw new BadRequestException('Only pending orders can be cancelled');
    }

    // Refund if wallet was charged
    if (order.paymentStatus === 'PAID' && order.paymentMethod === 'WALLET') {
      await this.walletService.credit(
        userId, Number(order.total),
        `Refund for cancelled order ${order.orderNumber}`,
        `استرداد للطلب الملغي ${order.orderNumber}`,
        orderId, 'REFUND'
      );
    }

    // Update order
    await this.prisma.merchantOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        paymentStatus: order.paymentStatus === 'PAID' ? 'REFUNDED' : order.paymentStatus,
        cancelledAt: new Date(),
      },
    });

    await this.prisma.merchantOrderEvent.create({
      data: {
        orderId,
        type: 'STATUS_CHANGED',
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        message: dto.reason || 'Order cancelled by merchant',
        actorType: 'MERCHANT',
      },
    });

    this.logger.log(`Order ${order.orderNumber} cancelled`);

    return { ok: true };
  }

  // Submit bank transfer proof
  async submitBankTransferProof(merchantId: string, orderId: string, dto: SubmitBankTransferProofDto) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: dto.paymentIntentId, orderId, merchantId },
    });

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    if (intent.status !== 'REQUIRES_ACTION') {
      throw new BadRequestException('Invalid payment intent status');
    }

    await this.prisma.paymentIntent.update({
      where: { id: dto.paymentIntentId },
      data: {
        status: 'PENDING_REVIEW',
        proofAttachmentUrl: dto.proofAttachmentUrl,
        reviewNote: dto.note,
      },
    });

    this.logger.log(`Bank transfer proof submitted for order ${orderId}`);

    return { ok: true, status: 'PENDING_REVIEW' };
  }

  // Helper to format order response
  private formatOrderResponse(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      source: order.source,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      feesTotal: Number(order.feesTotal),
      taxTotal: Number(order.taxTotal),
      total: Number(order.total),
      profitTotal: Number(order.profitTotal),
      currency: order.currency,
      itemsCount: order.items.length,
      items: order.items.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productNameSnapshotEn,
        productNameAr: item.productNameSnapshotAr,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        deliveries: item.deliveries?.map((d: any) => ({
          cardCode: d.cardCode,
          cardPin: d.cardPin,
          deliveredAt: d.deliveredAt,
          viewedAt: d.viewedAt,
        })),
      })),
      events: order.events?.map((e: any) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        message: e.message,
        actorType: e.actorType,
        createdAt: e.createdAt,
      })),
      paymentIntent: order.paymentIntents?.[0] ? {
        id: order.paymentIntents[0].id,
        method: order.paymentIntents[0].method,
        status: order.paymentIntents[0].status,
        amount: Number(order.paymentIntents[0].amount),
        currency: order.paymentIntents[0].currency,
        bankDetails: order.paymentIntents[0].bankAccount ? {
          bankName: order.paymentIntents[0].bankAccount.name,
          bankNameAr: order.paymentIntents[0].bankAccount.nameAr,
          accountName: order.paymentIntents[0].bankAccount.accountName,
          accountNumber: order.paymentIntents[0].bankAccount.accountNumber,
          iban: order.paymentIntents[0].bankAccount.iban,
        } : undefined,
        proofAttachmentUrl: order.paymentIntents[0].proofAttachmentUrl,
        expiresAt: order.paymentIntents[0].expiresAt,
      } : undefined,
      player: order.player ? {
        id: order.player.id,
        name: order.player.name,
        phone: order.player.phone,
      } : undefined,
      invoice: order.invoice ? {
        id: order.invoice.id,
        invoiceNumber: order.invoice.invoiceNumber,
        issuedAt: order.invoice.issuedAt,
      } : undefined,
      createdAt: order.createdAt,
      completedAt: order.completedAt,
    };
  }
}


import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';
import { CardInventoryService } from './card-inventory.service';
import { CardProductService } from './card-product.service';
import { Decimal } from '@prisma/client/runtime/library';
import { NotificationsService } from '../notifications/notifications.service';
import * as XLSX from 'xlsx';

import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItem {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItem)
  items!: OrderItem[];

  @IsString()
  @IsOptional()
  notes?: string;
}

@Injectable()
export class CardOrderService {
  private readonly logger = new Logger(CardOrderService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private cardInventoryService: CardInventoryService,
    private cardProductService: CardProductService,
    private notificationsService: NotificationsService,
  ) {}

  // Generate order number
  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomInt(0, 1000000).toString(36).substring(0, 4).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  // Create a new order
  async createOrder(tenantId: string, userId: string, data: CreateOrderDto, ipAddress?: string, userAgent?: string) {
    // Validate items
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    // Calculate totals and validate products
    let totalAmount = new Decimal(0);
    let totalTax = new Decimal(0);
    const orderItems: any[] = [];
    const reservedCardIds: Map<string, string[]> = new Map();

    for (const item of data.items) {
      // Get product
      const product = await this.cardProductService.findOne(tenantId, item.productId);

      if (!product.isActive || !product.isAvailable) {
        throw new BadRequestException(`Product ${product.name} is not available at this time`);
      }

      if (item.quantity < product.minQuantity || item.quantity > product.maxQuantity) {
        throw new BadRequestException(
          `Quantity for ${product.name} must be between ${product.minQuantity} and ${product.maxQuantity}`,
        );
      }

      // Check stock
      if (product.availableStock < item.quantity) {
        throw new BadRequestException(`Only ${product.availableStock} cards available for ${product.name}`);
      }

      // Calculate item totals
      const unitPrice = new Decimal(product.wholesalePrice);
      const itemTotal = unitPrice.times(item.quantity);
      const taxRate = new Decimal(product.taxRate);
      const itemTax = itemTotal.times(taxRate);
      const itemTotalWithTax = itemTotal.plus(itemTax);

      totalAmount = totalAmount.plus(itemTotal);
      totalTax = totalTax.plus(itemTax);

      orderItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: unitPrice.toNumber(),
        totalPrice: itemTotal.toNumber(),
        taxAmount: itemTax.toNumber(),
        totalWithTax: itemTotalWithTax.toNumber(),
      });
    }

    const totalWithTax = totalAmount.plus(totalTax);

    // Check wallet balance
    const hasFunds = await this.walletService.hasSufficientBalance(userId, totalWithTax.toNumber());
    if (!hasFunds) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    // Create order in transaction
    const orderNumber = this.generateOrderNumber();

    try {
      // Start transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Create order
        const order = await tx.cardOrder.create({
          data: {
            tenantId,
            userId,
            orderNumber,
            status: 'PENDING',
            totalAmount: totalAmount.toNumber(),
            taxAmount: totalTax.toNumber(),
            totalWithTax: totalWithTax.toNumber(),
            currency: 'SAR',
            paymentMethod: 'WALLET',
            paymentStatus: 'PENDING',
            notes: data.notes,
            ipAddress,
            userAgent,
          },
        });

        // Create order items
        for (const item of orderItems) {
          await tx.cardOrderItem.create({
            data: {
              orderId: order.id,
              ...item,
            },
          });
        }

        // Reserve cards for each item
        for (const item of data.items) {
          const cardIds = await this.cardInventoryService.reserveCards(item.productId, item.quantity, order.id);
          reservedCardIds.set(item.productId, cardIds);
        }

        // Check balance but don't deduct yet [TASK 1]
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet || new Decimal(wallet.balance).lessThan(totalWithTax)) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        // Update order to PENDING (wait for reveal)
        const pendingOrder = await tx.cardOrder.update({
          where: { id: order.id },
          data: {
            status: 'PENDING',
            paymentStatus: 'PENDING',
          },
        });

        return pendingOrder;
      });

      // Process delivery (mark cards as sold and create deliveries)
      await this.processDelivery(result.id, userId);

      // Update product stock counts
      for (const productId of reservedCardIds.keys()) {
        await this.cardProductService.updateStockCount(productId);
      }

      // Get full order with items
      const fullOrder = await this.getOrder(tenantId, userId, result.id);

      this.logger.log(`Order ${orderNumber} created and delivered for user ${userId}`);

      return fullOrder;
    } catch (error) {
      // Release any reserved cards if something fails
      for (const cardIds of reservedCardIds.values()) {
        await this.cardInventoryService.releaseCards(cardIds);
      }
      throw error;
    }
  }

  // Process delivery - mark cards as sold and create delivery records
  private async processDelivery(orderId: string, userId: string) {
    const order = await this.prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: { items: true, cards: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Get reserved cards for this order
    const reservedCards = await this.prisma.cardInventory.findMany({
      where: { orderId, status: 'RESERVED' },
    });

    // Mark cards as sold
    await this.cardInventoryService.markAsSold(
      reservedCards.map((c) => c.id),
      userId,
      orderId,
    );

    // Create delivery records for each order item
    for (const item of order.items) {
      const itemCards = reservedCards.filter((c) => c.productId === item.productId);

      for (const card of itemCards) {
        await this.prisma.cardDelivery.create({
          data: {
            orderItemId: item.id,
            cardCode: card.cardCode,
            cardPin: card.cardPin,
          },
        });
      }

      // Update delivered count
      await this.prisma.cardOrderItem.update({
        where: { id: item.id },
        data: { deliveredCount: itemCards.length },
      });
    }

    // Update order status
    await this.prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });

    // Send notification
    try {
      await this.notificationsService.create({
        tenantId: order.tenantId,
        userId: userId,
        type: 'order',
        titleEn: 'Order Delivered',
        titleAr: 'تم تسليم الطلب',
        bodyEn: `Your order #${order.orderNumber} has been delivered. You can now view your card codes.`,
        bodyAr: `تم تسليم طلبك رقم #${order.orderNumber}. يمكنك الآن عرض أكواد البطاقات.`,
        data: { orderId: order.id },
      });
    } catch (e) {
      this.logger.error('Failed to send order delivery notification', e);
    }
  }

  // Get single order with details
  async getOrder(tenantId: string, userId: string, orderId: string) {
    const order = await this.prisma.cardOrder.findFirst({
      where: { id: orderId, tenantId, userId },
      include: {
        items: {
          include: {
            product: {
              include: { brand: true },
            },
            deliveries: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  // Get user orders
  async getUserOrders(
    tenantId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
  ) {
    const where: any = { tenantId, userId };
    if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      this.prisma.cardOrder.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                include: { brand: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardOrder.count({ where }),
    ]);

    return {
      data: orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Get all orders (admin)
  async getAllOrders(
    tenantId: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
    userId?: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }
    if (userId) {
      where.userId = userId;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    const [orders, total] = await Promise.all([
      this.prisma.cardOrder.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cardOrder.count({ where }),
    ]);

    return {
      data: orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Cancel order (if not yet processed)
  async cancelOrder(tenantId: string, userId: string, orderId: string, reason: string) {
    const order = await this.prisma.cardOrder.findFirst({
      where: { id: orderId, tenantId, userId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException('Only pending orders can be cancelled');
    }

    // Release reserved cards
    const reservedCards = await this.prisma.cardInventory.findMany({
      where: { orderId, status: 'RESERVED' },
    });

    await this.cardInventoryService.releaseCards(reservedCards.map((c) => c.id));

    // Update order status
    await this.prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    // Refund wallet if payment was made
    if (order.paymentStatus === 'COMPLETED') {
      await this.walletService.credit(
        userId,
        Number(order.totalWithTax),
        `Refund for cancelled order ${order.orderNumber}`,
        `استرداد للطلب الملغي ${order.orderNumber}`,
        orderId,
        'REFUND',
      );
    }

    // Update product stock counts
    const productIds = [...new Set(reservedCards.map((c) => c.productId))];
    for (const productId of productIds) {
      if (typeof productId === 'string') {
        await this.cardProductService.updateStockCount(productId);
      }
    }

    this.logger.log(`Order ${order.orderNumber} cancelled. Reason: ${reason}`);

    return { success: true };
  }

  // Get order statistics (admin)
  async getOrderStats(tenantId: string, startDate?: Date, endDate?: Date) {
    const where: any = { tenantId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    const [totalOrders, deliveredOrders, cancelledOrders, totalRevenue] = await Promise.all([
      this.prisma.cardOrder.count({ where }),
      this.prisma.cardOrder.count({ where: { ...where, status: 'DELIVERED' } }),
      this.prisma.cardOrder.count({ where: { ...where, status: 'CANCELLED' } }),
      this.prisma.cardOrder.aggregate({
        where: { ...where, status: 'DELIVERED' },
        _sum: { totalWithTax: true },
      }),
    ]);

    return {
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      pendingOrders: totalOrders - deliveredOrders - cancelledOrders,
      totalRevenue: totalRevenue._sum.totalWithTax || 0,
    };
  }

  // Generate Excel and Text files for the order
  async generateOrderFiles(tenantId: string, userId: string, orderId: string) {
    const order = await this.getOrder(tenantId, userId, orderId);
    
    const codes: any[] = [];
    const textLines: string[] = [];

    textLines.push(`Order Number: ${order.orderNumber}`);
    textLines.push(`Date: ${new Date(order.createdAt).toLocaleString()}`);
    textLines.push('-------------------------------------------');

    for (const item of order.items) {
      const productName = item.product.nameAr || item.product.name;
      textLines.push(`\nProduct: ${productName}`);
      
      for (const delivery of item.deliveries) {
        // Salla format: Code, PIN (optional), Product Name
        codes.push({
          'Code': delivery.cardCode,
          'PIN': delivery.cardPin || '',
          'Product Name': productName,
        });

        textLines.push(`Code: ${delivery.cardCode}${delivery.cardPin ? ` | PIN: ${delivery.cardPin}` : ''}`);
      }
    }

    // Generate Excel
    const worksheet = XLSX.utils.json_to_sheet(codes);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Codes');
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Generate Text
    const textBuffer = Buffer.from(textLines.join('\n'), 'utf-8');

    return {
      excel: excelBuffer.toString('base64'),
      text: textBuffer.toString('base64'),
      fileName: `Order_${order.orderNumber}`,
    };
  }
}


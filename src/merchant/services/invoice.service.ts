import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(private prisma: PrismaService) {}

  // Generate invoice number
  private async generateInvoiceNumber(merchantId: string): Promise<string> {
    const count = await this.prisma.invoice.count({
      where: { merchantId },
    });

    const year = new Date().getFullYear();
    const num = String(count + 1).padStart(6, '0');

    return `INV-${year}-${num}`;
  }

  // Create invoice for completed order
  async createForOrder(orderId: string) {
    const order = await this.prisma.merchantOrder.findUnique({
      where: { id: orderId },
      include: {
        merchant: true,
        player: true,
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Check if invoice already exists
    const existing = await this.prisma.invoice.findUnique({
      where: { orderId },
    });

    if (existing) {
      return existing;
    }

    const invoiceNumber = await this.generateInvoiceNumber(order.merchantId);

    // Create snapshots
    const merchantSnapshot = {
      id: order.merchant.id,
      businessName: order.merchant.businessName,
      businessNameAr: order.merchant.businessNameAr,
      phone: order.merchant.phone,
      email: order.merchant.email,
    };

    const buyerSnapshot = order.player ? {
      id: order.player.id,
      name: order.player.name,
      phone: order.player.phone,
    } : null;

    const itemsSnapshot = order.items.map((item) => ({
      productId: item.productId,
      productName: item.productNameSnapshotEn,
      productNameAr: item.productNameSnapshotAr,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    }));

    const totalsSnapshot = {
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      feesTotal: Number(order.feesTotal),
      taxTotal: Number(order.taxTotal),
      total: Number(order.total),
    };

    const paymentSnapshot = {
      method: order.paymentMethod,
      status: order.paymentStatus,
    };

    const invoice = await this.prisma.invoice.create({
      data: {
        merchantId: order.merchantId,
        orderId,
        invoiceNumber,
        status: 'ISSUED',
        currency: order.currency,
        merchantSnapshot,
        buyerSnapshot,
        itemsSnapshot,
        totalsSnapshot,
        paymentSnapshot,
      },
    });

    this.logger.log(`Created invoice ${invoiceNumber} for order ${order.orderNumber}`);

    return invoice;
  }

  // Get invoices for merchant
  async findAll(merchantId: string, query: { from?: string; to?: string; status?: string; cursor?: string; limit?: number }) {
    const limit = query.limit || 20;
    const where: any = { merchantId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.from || query.to) {
      where.issuedAt = {};
      if (query.from) where.issuedAt.gte = new Date(query.from);
      if (query.to) where.issuedAt.lte = new Date(query.to);
    }

    const cursorOptions: any = {};
    if (query.cursor) {
      cursorOptions.cursor = { id: query.cursor };
      cursorOptions.skip = 1;
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        order: { select: { orderNumber: true, createdAt: true } },
      },
      orderBy: { issuedAt: 'desc' },
      take: limit + 1,
      ...cursorOptions,
    });

    const hasMore = invoices.length > limit;
    const items = hasMore ? invoices.slice(0, limit) : invoices;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        orderNumber: inv.order.orderNumber,
        orderId: inv.orderId,
        status: inv.status,
        currency: inv.currency,
        totals: inv.totalsSnapshot,
        issuedAt: inv.issuedAt,
        orderDate: inv.order.createdAt,
      })),
      nextCursor,
    };
  }

  // Get single invoice
  async findOne(merchantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, merchantId },
      include: {
        order: { select: { orderNumber: true, createdAt: true } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.order.orderNumber,
      orderId: invoice.orderId,
      status: invoice.status,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
      orderDate: invoice.order.createdAt,
      merchant: invoice.merchantSnapshot,
      buyer: invoice.buyerSnapshot,
      items: invoice.itemsSnapshot,
      totals: invoice.totalsSnapshot,
      payment: invoice.paymentSnapshot,
    };
  }

  // Void invoice (admin action)
  async voidInvoice(merchantId: string, invoiceId: string, reason?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, merchantId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'VOIDED' },
    });

    this.logger.log(`Voided invoice ${invoice.invoiceNumber}`);

    return { ok: true };
  }
}


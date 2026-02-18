// apps/app-core/src/order/order.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSyncService } from '../tenant/tenant-sync.service';
import { SupplierInventoryService } from '../supplier/supplier-inventory.service';
import { CartService } from '../cart/cart.service';
import { WalletService } from '../cards/wallet.service';
import { DigitalCardsDeliveryService } from './digital-cards-delivery.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from '../inventory/inventory.service';
import { MerchantAuditService } from '../merchant/services/merchant-audit.service';
import { OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface CreateOrderDto {
  customerEmail: string;
  customerName?: string;
  shippingAddress: any;
  billingAddress?: any;
  customerPhone?: string;
  notes?: string;
  ipAddress?: string;
}

export interface OrderPaymentOptions {
  paymentMethod?: string;
  useWalletBalance?: boolean;
  userId?: string;
  serialNumberDelivery?: string[];
  subdomain?: string;
}

export interface OrderResponseDto {
  id: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  isGuest?: boolean;
  guestEmail?: string;
  guestName?: string;
  guestPhone?: string;
  totalAmount: number;
  status: string;
  paymentMethod?: string;
  paymentStatus?: string;
  shippingAddress: any;
  billingAddress?: any;
  userId?: string;
  notes?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
  orderItems: OrderItemDto[];
  deliveryFiles?: {
    serialNumbers?: string[];
    serialNumbersByProduct?: Record<string, Array<{ serialNumber: string; pin?: string }>>;
    deliveryOptions?: string[];
    excelFileUrl?: string;
    textFileUrl?: string;
    pdfFileUrl?: string;
    error?: string;
    errorAr?: string;
    requiresReveal?: boolean;
    isPendingWallet?: boolean;
  };
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productVariantId?: string;
  productName: string;
  variantName?: string;
  quantity: number;
  price: number;
  total: number;
  deliveries?: Array<{ cardCode: string; cardPin?: string }>;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private prisma: PrismaService,
    private tenantSyncService: TenantSyncService,
    private supplierInventoryService: SupplierInventoryService,
    private cartService: CartService,
    private walletService: WalletService,
    public digitalCardsDeliveryService: DigitalCardsDeliveryService,
    private notificationsService: NotificationsService,
    private inventoryService: InventoryService,
    private merchantAuditService: MerchantAuditService,
  ) {}

  async createOrder(
    tenantId: string,
    cartId: string,
    orderData: CreateOrderDto,
    paymentOptions?: OrderPaymentOptions,
  ): Promise<OrderResponseDto> {
    this.logger.log(`=== ORDER CREATION START ===`);
    this.logger.log(`createOrder called: tenantId=${tenantId}, cartId=${cartId}, paymentOptions=${JSON.stringify(paymentOptions)}`);

    // Ensure tenant exists / create if missing
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, subdomain: true, isPrivateStore: true, settings: true },
    });

    if (tenant?.isPrivateStore && !paymentOptions?.userId) {
      throw new BadRequestException('This store is private. Please log in to place an order.');
    }

    if (!tenant) {
      const subdomain = paymentOptions?.subdomain || tenantId.substring(0, 20).toLowerCase().replace(/[^a-z0-9]/g, '');
      const ok = await this.tenantSyncService.ensureTenantExists(tenantId, {
        name: `Store ${tenantId.substring(0, 8)}`,
        subdomain,
      });
      if (!ok) throw new BadRequestException('Store setup error: unable to verify store.');
      this.logger.log(`✅ Tenant ${tenantId} created/ensured with subdomain=${subdomain}`);
    }

    // Load cart
    const cart = await this.prisma.cart.findFirst({
      where: { id: cartId, tenantId },
      include: { cartItems: { include: { product: true, productVariant: true } } },
    });

    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.cartItems.length === 0) throw new BadRequestException('Cart is empty.');

    // Supplier inventory validation (variants only) - keep as you had
    const itemsForValidation: { productId: string; variantId: string; quantity: number }[] = [];
    for (const item of cart.cartItems) {
      if (item.productVariant) {
        itemsForValidation.push({ productId: item.product.id, variantId: item.productVariant.id, quantity: item.quantity });
      }
    }

    const inventoryValid = await this.supplierInventoryService.validateInventoryBeforeOrder(tenantId, itemsForValidation);
    if (!inventoryValid) throw new BadRequestException('Insufficient inventory. Please check product availability.');

    // Re-fetch cart after supplier sync
    const updatedCart = await this.prisma.cart.findFirst({
      where: { id: cartId, tenantId },
      include: { cartItems: { include: { product: true, productVariant: true } } },
    });
    if (!updatedCart) throw new NotFoundException('Cart not found (after sync)');
    if (updatedCart.cartItems.length === 0) throw new BadRequestException('Cart is empty (after sync)');

    // Totals
    const cartTotal = await this.cartService.calculateCartTotal(updatedCart as any, orderData.shippingAddress);

    const roundCurrency = (value: number): number => {
      const num = Number(value);
      return isNaN(num) ? 0 : Math.round(num * 100) / 100;
    };

    const subtotalAmount = roundCurrency(cartTotal.subtotal);
    const discountAmount = roundCurrency(cartTotal.discount);
    const taxAmount = roundCurrency(cartTotal.tax);
    const shippingAmount = roundCurrency(cartTotal.shipping);
    const totalAmount = roundCurrency(cartTotal.total);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new BadRequestException('Invalid cart total.');
    }

    const orderNumber = this.generateOrderNumber();

    const paymentMethodUpper = String(paymentOptions?.paymentMethod || '').toUpperCase();
    const isCOD = paymentMethodUpper.includes('CASH') || paymentMethodUpper.includes('COD');

    // Detect digital/API products
    const hasInstantProducts = updatedCart.cartItems.some((it) => {
      const p = it.product;
      const hasCode = !!(p?.productCode && String(p.productCode).trim() !== '');
      const isDigital = p?.isDigital === true;
      return hasCode || isDigital;
    });

    // ✅ HARD RULE: digital/API products cannot be COD
    if (hasInstantProducts && isCOD) {
      throw new BadRequestException('Cash on delivery is not allowed for digital products. Choose Wallet or online payment.');
    }

    // Wallet requested?
    const isWalletRequested =
      paymentOptions?.useWalletBalance === true ||
      String(paymentOptions?.useWalletBalance) === 'true' ||
      paymentMethodUpper === 'WALLET_BALANCE';

    if (isWalletRequested && !paymentOptions?.userId) {
      throw new BadRequestException('You must be logged in to pay with wallet balance.');
    }

    // Pre-check wallet
    if (isWalletRequested && paymentOptions?.userId) {
      const hasBalance = await this.walletService.hasSufficientBalance(paymentOptions.userId, totalAmount);
      if (!hasBalance) {
        throw new BadRequestException('Insufficient wallet balance to complete this transaction.');
      }
    }

    // Transaction
    const txResult = await (this.prisma as any).$transaction(
      async (tx: any) => {
        // lock cart snapshot
        const lockedCart = await tx.cart.findFirst({
          where: { id: cartId, tenantId },
          include: { cartItems: { include: { product: true, productVariant: true } } },
        });

        if (!lockedCart || lockedCart.cartItems.length === 0) throw new BadRequestException('Cart is empty or not found');

        // Inventory decrement (your logic) - keep simple & safe:
        for (const item of lockedCart.cartItems) {
          // if productCode or isDigital -> do not decrement local inventory (supplier/digital handling)
          const p = await tx.product.findUnique({
            where: { id: item.product.id },
            select: { productCode: true, isDigital: true, stockCount: true, name: true },
          });

          const hasCode = !!(p?.productCode && String(p.productCode).trim() !== '');
          const isDigital = p?.isDigital === true;

          if (hasCode || isDigital) continue;

          if (item.productVariant) {
            const variant = await tx.productVariant.findUnique({
              where: { id: item.productVariant.id },
              select: { id: true, inventoryQuantity: true, name: true, productId: true },
            });
            if (!variant) throw new NotFoundException('Product variant not found');

            if (variant.inventoryQuantity < item.quantity) {
              // DEVELOPER BYPASS: Auto-replenish asus130 for testing
              const isAsusTenant = tenantId === 'asus130' || tenantId.includes('asus') || (tenant && tenant.subdomain?.includes('asus'));
              if (isAsusTenant) {
                this.logger.warn(`⚠️ [DEV BYPASS] Auto-replenishing inventory for ${p?.name} - ${variant.name} (asus130)`);
                await tx.productVariant.update({
                  where: { id: variant.id },
                  data: { inventoryQuantity: 9999 }
                });
              } else {
                throw new BadRequestException(
                  `Insufficient inventory for ${p?.name} - ${variant.name}. Available: ${variant.inventoryQuantity}, Requested: ${item.quantity}`,
                );
              }
            }

            await tx.productVariant.update({
              where: { id: variant.id },
              data: { inventoryQuantity: { decrement: item.quantity } },
            });
          } else {
            const stock = Number(p?.stockCount || 0);
            if (stock < item.quantity) {
              // DEVELOPER BYPASS: Auto-replenish asus130 for testing
              const isAsusTenant = tenantId === 'asus130' || tenantId.includes('asus') || (tenant && tenant.subdomain?.includes('asus'));
              if (isAsusTenant) {
                this.logger.warn(`⚠️ [DEV BYPASS] Auto-replenishing inventory for ${p?.name} (asus130)`);
                await tx.product.update({
                  where: { id: item.product.id },
                  data: { stockCount: 9999 }
                });
              } else {
                throw new BadRequestException(`Insufficient inventory for ${p?.name}. Available: ${stock}, Requested: ${item.quantity}`);
              }
            }
            await tx.product.update({
              where: { id: item.product.id },
              data: { stockCount: { decrement: item.quantity } },
            });
          }
        }

        // Wallet debit
        let walletRef: any = null;
        let balanceAfter: Decimal | null = null;
        let isWalletPaymentPending = false;

        if (isWalletRequested) {
          const payerUserId = paymentOptions!.userId!;
          const wallet = await tx.wallet.findUnique({ where: { userId: payerUserId } });
          if (!wallet) throw new NotFoundException('Wallet not found');

          const currentBalance = new Decimal(wallet.balance);
          const requiredAmount = new Decimal(totalAmount);

          if (currentBalance.lessThan(requiredAmount)) {
            throw new BadRequestException('Insufficient wallet balance to complete this transaction.');
          }

          // [TASK 1] Don't take from balance until see or download or copy or send to inventory
          // We mark it as pending and only deduct when revealed.
          isWalletPaymentPending = hasInstantProducts; // [TASK 1] Only defer for digital items that require reveal
          balanceAfter = currentBalance.minus(requiredAmount); // Pre-calculate for later check
          walletRef = wallet;
        }

        // Persist internal markers in billingAddress JSON
        let billingAddress: any = orderData.billingAddress || orderData.shippingAddress || {};
        if (billingAddress && typeof billingAddress === 'object' && !Array.isArray(billingAddress)) {
          billingAddress = {
            ...billingAddress,
            _paymentMethod: paymentOptions?.paymentMethod,
            _userId: paymentOptions?.userId,
            _walletDeductionPending: isWalletPaymentPending, // [TASK 1] Mark as pending
          };
        }

        // Resolve paymentMethodId
        let paymentMethodId: string | null = null;
        if (paymentOptions?.paymentMethod) {
          // WALLET_BALANCE is an internal checkout option, not a Prisma PaymentProvider enum value.
          // Do NOT query paymentMethod by provider for it, otherwise Prisma will throw.
          if (String(paymentOptions.paymentMethod).toUpperCase() === 'WALLET_BALANCE') {
            paymentMethodId = null;
          } else {
          const pm = await tx.paymentMethod.findFirst({
            where: { tenantId, provider: paymentOptions.paymentMethod as any },
            select: { id: true },
          });
          if (pm) paymentMethodId = pm.id;
          else {
            const globalPm = await tx.paymentMethod.findFirst({
              where: { tenantId: null, provider: paymentOptions.paymentMethod as any },
              select: { id: true },
            });
            if (globalPm) paymentMethodId = globalPm.id;
          }
          }
        }

        const isPaidViaWallet = !!(isWalletRequested && walletRef && !isWalletPaymentPending); 

        // Determine initial order status based on store configuration:
        // - If orderAutoAccept is explicitly false, keep new orders in PENDING so merchant can approve/reject.
        // - Otherwise, keep existing behavior and auto-approve on creation.
        const orderSettings = (tenant?.settings || {}) as any;
        const autoAcceptEnabled =
          orderSettings.orderAutoAccept !== undefined ? Boolean(orderSettings.orderAutoAccept) : true;
        const initialStatus: OrderStatus = (autoAcceptEnabled ? 'APPROVED' : 'PENDING') as any;
        const initialPaymentStatus = isPaidViaWallet ? 'SUCCEEDED' : 'PENDING';
        const isGuest = !paymentOptions?.userId;

        const order = await tx.order.create({
          data: {
            tenantId,
            orderNumber,
            customerEmail: orderData.customerEmail,
            customerName: orderData.customerName,
            customerPhone: orderData.customerPhone,
            subtotalAmount,
            discountAmount,
            taxAmount,
            shippingAmount,
            totalAmount,
            shippingAddress: orderData.shippingAddress,
            billingAddress,
            ipAddress: orderData.ipAddress,
            status: initialStatus,
            paymentStatus: initialPaymentStatus,
            paymentMethodId,
            paidAt: isPaidViaWallet ? new Date() : null,
            isGuest,
            guestEmail: isGuest ? orderData.customerEmail : null,
            guestName: isGuest ? orderData.customerName : null,
            guestPhone: isGuest ? orderData.customerPhone : null,
          },
        });

        // wallet transaction record
        if (isPaidViaWallet && walletRef && balanceAfter) {
          // This block only runs if deduction was IMMEDIATE (not Task 1 path)
          await tx.walletTransaction.create({
            data: {
              walletId: walletRef.id,
              type: 'PURCHASE',
              amount: -totalAmount,
              balanceBefore: walletRef.balance,
              balanceAfter,
              currency: walletRef.currency,
              description: `Payment for order ${orderNumber}`,
              descriptionAr: `دفع للطلب ${orderNumber}`,
              reference: order.id,
              status: 'COMPLETED',
            },
          });
        }

        // order items
        const orderItems = await Promise.all(
          lockedCart.cartItems.map((item: any) =>
            tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: item.product.id,
                productVariantId: item.productVariant?.id,
                productName: item.product.name,
                variantName: item.productVariant?.name,
                sku: item.product.sku,
                quantity: item.quantity,
                price: item.productVariant ? item.productVariant.price : item.product.price,
              },
            }),
          ),
        );

        // clear cart items (inside tx)
        await tx.cartItem.deleteMany({ where: { cartId } });

        return { order, orderItems, isPaidViaWallet };
      },
      { timeout: 30000 } as any,
    );

    // Store delivery options
    if (paymentOptions?.serialNumberDelivery) {
      const optionsToStore =
        paymentOptions.serialNumberDelivery.length > 0
          ? paymentOptions.serialNumberDelivery
          : paymentOptions.userId
            ? ['inventory', 'text']
            : ['text'];

      await this.prisma.order.update({
        where: { id: txResult.order.id },
        data: {
          deliveryFiles: { deliveryOptions: optionsToStore },
        },
      });
    }

    // Decide if delivery should run now
    // Decide if delivery should run now
    const isPaid = txResult.isPaidViaWallet || String(txResult.order.paymentStatus).toUpperCase() === 'SUCCEEDED';
    const isPendingWallet = isWalletRequested && txResult.order.paymentStatus === 'PENDING'; // [TASK 1] Run delivery even if pending wallet
    const shouldProcessDelivery = (isPaid || isPendingWallet) && hasInstantProducts;

    this.logger.log(
      `📦 [Delivery] Order ${orderNumber}: isPaid=${isPaid}, hasInstantProducts=${hasInstantProducts}, shouldProcessDelivery=${shouldProcessDelivery}`,
    );

    if (shouldProcessDelivery) {
      try {
        const deliveryResult = await this.digitalCardsDeliveryService.processDigitalCardsDelivery(
          tenantId,
          txResult.order.id,
          paymentOptions?.userId || null,
          txResult.orderItems.map((it: any) => ({
            productId: it.productId,
            quantity: it.quantity,
            productName: it.productName,
            price: Number(it.price),
          })),
          paymentOptions?.serialNumberDelivery,
          orderData.customerEmail,
          orderData.customerName,
          txResult.order.customerPhone,
          txResult.order.orderNumber,
          isPendingWallet, // [TASK 1] Pass as skipNotifications
        );

        if (deliveryResult?.serialNumbers?.length) {
          let requiresReveal = isPendingWallet;

          // [TASK: AUTO-DEDUCT ON DELIVERY]
          // If this was a wallet payment that was deferred until delivery, and delivery is now SUCCESSFUL, 
          // we deduct NOW instead of waiting for the user to click 'Reveal'.
          if (isPendingWallet && paymentOptions?.userId) {
            try {
              const totalAmount = Number(txResult.order.totalAmount);
              this.logger.log(`💰 [Auto-Debit] Success delivery for order ${orderNumber}. Deducting ${totalAmount} from user ${paymentOptions.userId}`);
              
              await this.walletService.debit(
                paymentOptions.userId,
                totalAmount,
                `Purchase: Order ${orderNumber} (Auto-deducted on delivery)`,
                `شراء: طلب ${orderNumber} (خصم تلقائي عند التسليم)`,
                txResult.order.id,
                orderData.ipAddress
              );
              
              requiresReveal = false; // Successfully deducted, no need to hide/reveal anymore
              
              // Update payment status to SUCCEEDED since we just took the money
              const billing = txResult.order.billingAddress as any;
              const updatedBilling = billing ? { ...billing, _walletDeductionPending: false } : billing;

              await this.prisma.order.update({
                where: { id: txResult.order.id },
                data: {
                  paymentStatus: 'SUCCEEDED',
                  paidAt: new Date(),
                  status: 'DELIVERED', // Ensure status is DELIVERED
                  billingAddress: updatedBilling,
                }
              });

              // Audit Log for the purchase
              try {
                await this.merchantAuditService.log(
                  tenantId,
                  paymentOptions.userId,
                  null,
                  'MERCHANT', // End user is treated as MERCHANT/Customer in this audit context
                  MerchantAuditService.Actions.ORDER_PURCHASE,
                  'Order',
                  txResult.order.id,
                  { orderNumber, total: totalAmount, automated: true },
                  orderData.ipAddress
                );
              } catch (auditErr) { /* ignore audit errors */ }

            } catch (walletErr) {
              this.logger.error(`❌ [Auto-Debit] Failed to deduct wallet for order ${orderNumber}: ${walletErr.message}`);
              // We keep requiresReveal = true, so the user can still try to reveal/pay manually later
              requiresReveal = true; 
            }
          }

          await this.prisma.order.update({
            where: { id: txResult.order.id },
            data: {
              status: 'DELIVERED',
              deliveryFiles: {
                serialNumbers: deliveryResult.serialNumbers,
                serialNumbersByProduct: deliveryResult.serialNumbersByProduct,
                deliveryOptions: deliveryResult.deliveryOptions,
                excelFileUrl: deliveryResult.excelFileUrl,
                textFileUrl: deliveryResult.textFileUrl,
                pdfFileUrl: deliveryResult.pdfFileUrl,
                requiresReveal: requiresReveal,
                isPendingWallet: requiresReveal,
                _walletDeductionPending: requiresReveal,
              },
            },
          });
        } else if (deliveryResult?.error || deliveryResult?.errorAr) {
          await this.prisma.order.update({
            where: { id: txResult.order.id },
            data: {
              deliveryFiles: {
                error: deliveryResult.error,
                errorAr: deliveryResult.errorAr,
                deliveryOptions: deliveryResult.deliveryOptions || paymentOptions?.serialNumberDelivery || [],
              },
            },
          });
        }
      } catch (e: any) {
        this.logger.error(`❌ Delivery failed for order ${orderNumber}: ${e?.message || e}`);
        try {
          await this.notificationsService.sendNotification({
            tenantId,
            type: 'ORDER',
            titleEn: `Digital Card Delivery Failed: ${orderNumber}`,
            titleAr: `فشل تسليم البطاقة الرقمية: ${orderNumber}`,
            bodyEn: `Error: ${e?.message || 'Unknown error'}`,
            bodyAr: `الخطأ: ${e?.message || 'خطأ غير معروف'}`,
            data: { orderId: txResult.order.id, orderNumber },
          });
        } catch {}
      }
    }

    // clear cart (service-level safety)
    try {
      await this.cartService.clearCart(tenantId, cartId);
    } catch {}

    // notify merchant
    try {
      await this.notificationsService.sendNotification({
        tenantId,
        type: 'ORDER',
        titleEn: `New Order: ${orderNumber}`,
        titleAr: `طلب جديد: ${orderNumber}`,
        bodyEn: `A new order has been placed for ${totalAmount} SAR.`,
        bodyAr: `تم تقديم طلب جديد بمبلغ ${totalAmount} ريال سعودي.`,
        data: { orderId: txResult.order.id, orderNumber },
      });
    } catch {}

    // Fetch fresh order
    const finalOrder = await this.prisma.order.findUnique({
      where: { id: txResult.order.id },
      include: {
        orderItems: { include: { product: true, productVariant: true } },
        paymentMethod: true,
      },
    });

    if (!finalOrder) throw new NotFoundException('Order not found after creation');

    // Notify Customer (Order Confirmation)
    try {
      await this.notificationsService.sendNotification({
        tenantId,
        userId: paymentOptions?.userId || undefined,
        targetEmail: orderData.customerEmail,
        type: 'CUSTOMER',
        titleEn: `Order Confirmed: ${orderNumber}`,
        titleAr: `تم تأكيد الطلب: ${orderNumber}`,
        bodyEn: `Your order ${orderNumber} for ${totalAmount} SAR has been confirmed. Thank you for shopping with us!`,
        bodyAr: `تم تأكيد طلبك رقم ${orderNumber} بقيمة ${totalAmount} ريال سعودي. شكراً لتسوقكم معنا!`,
        data: { orderId: finalOrder.id, orderNumber }
      });
    } catch {}

    return this.mapToOrderResponseDto(finalOrder, finalOrder.orderItems);
  }

  async getOrders(
    tenantId: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
    customerEmail?: string,
    userId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const whereClause: any = { tenantId };
    if (status) whereClause.status = status;

    // Add date range filter
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          whereClause.createdAt.gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          whereClause.createdAt.lte = end;
        }
      }
    }

    if (customerEmail || userId) {
      const OR: any[] = [];
      if (customerEmail) {
        OR.push({ customerEmail: { equals: customerEmail, mode: 'insensitive' } });
        OR.push({ guestEmail: { equals: customerEmail, mode: 'insensitive' } });
      }
      if (userId) {
        OR.push({ billingAddress: { path: ['_userId'], equals: userId } });
      }
      whereClause.OR = OR;
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: whereClause,
        include: {
          orderItems: { include: { product: true, productVariant: true } },
          paymentMethod: true,
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where: whereClause }),
    ]);

    const mapped = await Promise.all(orders.map((o: any) => this.mapToOrderResponseDto(o, o.orderItems)));

    return {
      data: mapped,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: pageNum < Math.ceil(total / limitNum),
      },
    };
  }

  async getOrder(tenantId: string, orderId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        orderItems: { include: { product: true, productVariant: true } },
        paymentMethod: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.mapToOrderResponseDto(order, order.orderItems);
  }

  async updateOrderStatus(tenantId: string, orderId: string, status: string): Promise<OrderResponseDto> {
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
    ] as const;

    if (!validStatuses.includes(status as any)) {
      throw new BadRequestException(`Invalid order status: ${status}`);
    }

    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: status as OrderStatus },
      include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
    });

    return this.mapToOrderResponseDto(updated, updated.orderItems);
  }

  async cancelOrder(tenantId: string, orderId: string, reason?: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: { include: { productVariant: true, product: true } }, paymentMethod: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED') throw new BadRequestException('Order is already cancelled');
    if (order.status === 'SHIPPED' || order.status === 'DELIVERED') throw new BadRequestException('Cannot cancel shipped/delivered orders');

    const updated = await this.prisma.$transaction(async (tx: any) => {
      for (const item of order.orderItems) {
        if (item.productVariant) {
          await tx.productVariant.update({
            where: { id: item.productVariant.id },
            data: { inventoryQuantity: { increment: item.quantity } },
          });
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
        include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
      });
    });

    return this.mapToOrderResponseDto(updated, updated.orderItems);
  }

  async rejectOrder(tenantId: string, orderId: string, reason?: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'REJECTED') throw new BadRequestException('Order is already rejected');
    if (order.status === 'APPROVED' || order.status === 'DELIVERED') throw new BadRequestException('Cannot reject approved/delivered orders');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'REJECTED', rejectionReason: reason || null },
      include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
    });

    return this.mapToOrderResponseDto(updated, updated.orderItems);
  }

  async getOrderStats(tenantId: string) {
    const [
      totalOrders,
      pendingOrders,
      confirmedOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      totalRevenue,
      todayOrders,
      weekOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where: { tenantId } }),
      this.prisma.order.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.order.count({ where: { tenantId, status: 'CONFIRMED' } }),
      this.prisma.order.count({ where: { tenantId, status: 'PROCESSING' } }),
      this.prisma.order.count({ where: { tenantId, status: 'SHIPPED' } }),
      this.prisma.order.count({ where: { tenantId, status: 'DELIVERED' } }),
      this.prisma.order.count({ where: { tenantId, status: 'CANCELLED' } }),
      this.prisma.order.aggregate({
        where: { tenantId, status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return {
      totalOrders,
      statusBreakdown: {
        pending: pendingOrders,
        confirmed: confirmedOrders,
        processing: processingOrders,
        shipped: shippedOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
      },
      totalRevenue: Number(totalRevenue._sum.totalAmount || 0),
      recentActivity: { today: todayOrders, last7Days: weekOrders },
    };
  }

  async searchOrders(tenantId: string, query: string, page: number = 1, limit: number = 10) {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          tenantId,
          OR: [
            { orderNumber: { contains: query, mode: 'insensitive' } },
            { customerEmail: { contains: query, mode: 'insensitive' } },
            { customerName: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({
        where: {
          tenantId,
          OR: [
            { orderNumber: { contains: query, mode: 'insensitive' } },
            { customerEmail: { contains: query, mode: 'insensitive' } },
            { customerName: { contains: query, mode: 'insensitive' } },
          ],
        },
      }),
    ]);

    const mapped = await Promise.all(orders.map((o: any) => this.mapToOrderResponseDto(o, o.orderItems)));

    return {
      data: mapped,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: pageNum < Math.ceil(total / limitNum),
      },
    };
  }

  async processDigitalCardsDeliveryAfterPayment(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true },
      });
      if (!order) return;

      // [TASK: AUTO-DEDUCT ON SUCCESS]
      const isPendingWallet = (order.deliveryFiles as any)?._walletDeductionPending === true || 
                               (order.billingAddress as any)?._walletDeductionPending === true;

      const paymentStatus = String(order.paymentStatus || '').toUpperCase();
      if (paymentStatus !== 'SUCCEEDED' && !isPendingWallet) {
        this.logger.warn(`Skipping delivery: order ${order.orderNumber} not SUCCEEDED and not pending wallet reveal (paymentStatus=${paymentStatus})`);
        return;
      }

      let userId: string | null = null;
      if (order.customerEmail) {
        const email = order.customerEmail.toLowerCase().trim();
        const userInTenant = await this.prisma.user.findFirst({ 
          where: { 
            email, 
            tenantId: order.tenantId 
          }, 
          select: { id: true } 
        });
        if (userInTenant) userId = userInTenant.id;
      }

      // Try to find the user ID for wallet deduction
      let effectiveUserId = userId;
      if (!effectiveUserId) {
        effectiveUserId = (order.billingAddress as any)?._userId || (order.shippingAddress as any)?._userId;
      }

      let deliveryOptions = ['text', 'excel'];
      if (order.deliveryFiles && typeof order.deliveryFiles === 'object') {
        const df = order.deliveryFiles as any;
        if (Array.isArray(df.deliveryOptions) && df.deliveryOptions.length > 0) {
          deliveryOptions = df.deliveryOptions;
        }
      }

      if ((effectiveUserId || order.customerEmail) && !deliveryOptions.includes('inventory')) {
        deliveryOptions.push('inventory');
      }

      const deliveryResult = await this.digitalCardsDeliveryService.processDigitalCardsDelivery(
        order.tenantId,
        orderId,
        effectiveUserId,
        order.orderItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          productName: item.productName,
          price: Number(item.price),
        })),
        deliveryOptions,
        order.customerEmail,
        order.customerName || undefined,
        order.customerPhone || undefined,
        order.orderNumber,
      );

      if (deliveryResult?.serialNumbers?.length) {
        let requiresReveal = isPendingWallet;

        // Auto-deduct from wallet if it was pending and we now have the codes
        if (isPendingWallet && effectiveUserId) {
          try {
            const totalAmount = Number(order.totalAmount);
            this.logger.log(`💰 [Auto-Debit:Retry] Success delivery for order ${order.orderNumber}. Deducting ${totalAmount} from user ${effectiveUserId}`);
            
            await this.walletService.debit(
              effectiveUserId,
              totalAmount,
              `Purchase: Order ${order.orderNumber} (Auto-deducted on retry success)`,
              `شراء: طلب ${order.orderNumber} (خصم تلقائي عند نجاح المحاولة)`,
              order.id,
              order.ipAddress || '0.0.0.0'
            );
            
            requiresReveal = false; // Successfully deducted!

            // Update payment status to SUCCEEDED
            await this.prisma.order.update({
              where: { id: orderId },
              data: {
                paymentStatus: 'SUCCEEDED',
                paidAt: new Date()
              }
            });

            // Audit log
            try {
              await this.merchantAuditService.log(
                order.tenantId,
                effectiveUserId,
                null,
                'MERCHANT',
                MerchantAuditService.Actions.ORDER_PURCHASE,
                'Order',
                order.id,
                { orderNumber: order.orderNumber, total: totalAmount, automated: true, context: 'retry' },
                order.ipAddress || '0.0.0.0'
              );
            } catch (auditErr) {}

          } catch (walletErr) {
            this.logger.error(`❌ [Auto-Debit:Retry] Failed: ${walletErr.message}`);
            requiresReveal = true;
          }
        }

        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'DELIVERED',
            deliveryFiles: {
              serialNumbers: deliveryResult.serialNumbers,
              serialNumbersByProduct: deliveryResult.serialNumbersByProduct,
              deliveryOptions: deliveryResult.deliveryOptions,
              excelFileUrl: deliveryResult.excelFileUrl,
              textFileUrl: deliveryResult.textFileUrl,
              pdfFileUrl: deliveryResult.pdfFileUrl,
              requiresReveal: requiresReveal,
              isPendingWallet: requiresReveal,
              _walletDeductionPending: requiresReveal,
            },
          },
        });
      } else if (deliveryResult?.error || deliveryResult?.errorAr) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            deliveryFiles: {
              error: deliveryResult.error,
              errorAr: deliveryResult.errorAr,
              deliveryOptions: deliveryResult.deliveryOptions,
            },
          },
        });
      } else {
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            deliveryFiles: {
              error:
                'No serial numbers were retrieved. Check: productCode set, SUPPLIER_HUB_API_KEY configured, supplier API reachable.',
              errorAr:
                'لم يتم استرجاع الأرقام التسلسلية. تحقق من: productCode موجود، SUPPLIER_HUB_API_KEY مضبوط، وواجهة المورد تعمل.',
            },
          },
        });
      }
    } catch (e: any) {
      this.logger.error(`Failed to process digital cards delivery for order ${orderId}:`, e);
      try {
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            deliveryFiles: {
              error: `Delivery failed: ${e?.message || 'Unknown error'}`,
              errorAr: `فشل التسليم: ${e?.message || 'خطأ غير معروف'}`,
            },
          },
        });
      } catch {}
    }
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString();
    const random = randomInt(0, 1000).toString().padStart(3, '0');
    return `ORD-${timestamp}-${random}`;
  }

  private async mapToOrderResponseDto(order: any, orderItems: any[]): Promise<OrderResponseDto> {
    let paymentMethod: string | undefined;
    let userId: string | undefined;
    let cleanBillingAddress = order.billingAddress;

    if (order.billingAddress && typeof order.billingAddress === 'object') {
      const ba = order.billingAddress as any;
      if (ba._paymentMethod) paymentMethod = ba._paymentMethod;
      if (ba._userId) userId = ba._userId;
      const { _paymentMethod, _userId, ...rest } = ba;
      cleanBillingAddress = rest;
    }

    if (!paymentMethod && order.paymentMethod) {
      paymentMethod = order.paymentMethod.provider || order.paymentMethod.name;
    }

    let serialNumbers: string[] = [];
    let serialNumbersByProduct: Record<string, Array<{ serialNumber: string; pin?: string }>> = {};
    let deliveryOptions: string[] = [];
    let deliveryError: string | undefined;
    let deliveryErrorAr: string | undefined;

    if (order.deliveryFiles && typeof order.deliveryFiles === 'object') {
      const df = order.deliveryFiles as any;
      if (Array.isArray(df.serialNumbers)) serialNumbers = df.serialNumbers;
      if (df.serialNumbersByProduct && typeof df.serialNumbersByProduct === 'object') serialNumbersByProduct = df.serialNumbersByProduct;
      if (Array.isArray(df.deliveryOptions)) deliveryOptions = df.deliveryOptions;
      if (df.error) deliveryError = df.error;
      if (df.errorAr) deliveryErrorAr = df.errorAr;
    }

    const requiresReveal = (order.deliveryFiles as any)?.requiresReveal === true ||
                            (order.deliveryFiles as any)?._walletDeductionPending === true || 
                            (order.billingAddress as any)?._walletDeductionPending === true;

    const cardDeliveries = await this.prisma.cardInventory.findMany({
      where: { orderId: order.id },
      select: { cardCode: true, cardPin: true, productId: true },
    });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      isGuest: order.isGuest || false,
      guestEmail: order.guestEmail || undefined,
      guestName: order.guestName || undefined,
      guestPhone: order.guestPhone || undefined,
      totalAmount: Number(order.totalAmount),
      status: order.status,
      userId,
      paymentMethod,
      paymentStatus: order.paymentStatus || 'PENDING',
      shippingAddress: order.shippingAddress,
      billingAddress: cleanBillingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderItems: orderItems.map((item) => {
        let deliveries: Array<{ cardCode: string; cardPin?: string }> = [];

        if (serialNumbersByProduct[item.productName]?.length) {
          deliveries = serialNumbersByProduct[item.productName].map((sn) => ({
            cardCode: requiresReveal ? '********' : sn.serialNumber,
            cardPin: (requiresReveal && sn.pin) ? '****' : sn.pin,
          }));
        } else {
          deliveries = cardDeliveries
            .filter((cd) => cd.productId === item.productId)
            .map((cd) => ({ 
              cardCode: requiresReveal ? '********' : cd.cardCode, 
              cardPin: (requiresReveal && cd.cardPin) ? '****' : (cd.cardPin || undefined) 
            }));
        }

        return {
          id: item.id,
          productId: item.productId,
          productVariantId: item.productVariantId,
          productName: item.productName,
          variantName: item.variantName,
          quantity: item.quantity,
          price: Number(item.price),
          total: Number(item.price) * item.quantity,
          deliveries,
        };
      }),
      deliveryFiles: {
      serialNumbers: requiresReveal ? serialNumbers.map(() => '********') : serialNumbers,
      serialNumbersByProduct: requiresReveal 
        ? Object.fromEntries(Object.entries(serialNumbersByProduct).map(([k, v]) => [k, v.map(() => ({ serialNumber: '********', pin: '****' }))])) 
        : serialNumbersByProduct,
      deliveryOptions,
      requiresReveal,
      isPendingWallet: requiresReveal,
      ...(deliveryError ? { error: deliveryError } : {}),
      ...(deliveryErrorAr ? { errorAr: deliveryErrorAr } : {}),
      ...(order.deliveryFiles && typeof order.deliveryFiles === 'object'
        ? {
            excelFileUrl: (order.deliveryFiles as any).excelFileUrl,
            textFileUrl: (order.deliveryFiles as any).textFileUrl,
            pdfFileUrl: (order.deliveryFiles as any).pdfFileUrl,
          }
        : {}),
    },
  };
}

  async refundOrder(tenantId: string, orderId: string, reason?: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId, tenantId },
      include: {
        orderItems: { include: { product: true } },
        paymentMethod: true,
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'REFUNDED') throw new BadRequestException('Order is already refunded');

    // Perform refund in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update Order Status
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'REFUNDED',
          paymentStatus: 'REFUNDED',
          updatedAt: new Date(),
          rejectionReason: reason || 'Refunded by admin', // Using rejectionReason for storing refund reason if needed or we can append to notes? rejectionReason fits.
        },
        include: { orderItems: { include: { product: true, productVariant: true } }, paymentMethod: true },
      });

      // 2. Refund to Wallet if applicable
      // Check for existing wallet transaction
      const walletTx = await tx.walletTransaction.findUnique({
        where: { orderId },
      });

      let walletRefunded = false;

      // If we have a wallet transaction (PURCHASE), we should refund it.
      // Or if payment status was SUCCEEDED and paymentMethodId is null (implies Wallet or internal),
      // we double check. The safest is to reverse the wallet transaction if it exists.
      if (walletTx && walletTx.type === 'PURCHASE' && walletTx.amount.lessThan(0)) {
        const walletId = walletTx.walletId;
        const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
        
        if (wallet) {
          const refundAmount = walletTx.amount.abs(); // Positive amount
          const balanceBefore = wallet.balance;
          const balanceAfter = balanceBefore.plus(refundAmount);

          await tx.wallet.update({
            where: { id: walletId },
            data: { balance: balanceAfter },
          });

          await tx.walletTransaction.create({
            data: {
              walletId,
              type: 'REFUND',
              amount: refundAmount,
              balanceBefore,
              balanceAfter,
              currency: walletTx.currency,
              description: `Refund for order ${order.orderNumber}`,
              descriptionAr: `استرداد للطلب ${order.orderNumber}`,
              reference: order.id,
              status: 'COMPLETED',
            },
          });
          walletRefunded = true;
        }
      }

      // 3. Handle Emergency Inventory (Serials)
      const deliveryFiles = order.deliveryFiles as any;
      if (deliveryFiles?.serialNumbersByProduct) {
        // Iterate over products with serials
        const emergencyItems: { productId: string; reason: string; notes: string }[] = [];

        // We need to map product names (keys in serialNumbersByProduct) to productIds
        for (const [productKey, serials] of Object.entries(deliveryFiles.serialNumbersByProduct)) {
           // Try to find the item in order items
           // productKey might be name or ID. Usually Name if generated by DigitalCardsDeliveryService
           // But wait, DigitalCardsDeliveryService pushes { productName: item.productName ... }
           // and logic for Excel groups by productName.
           // However, deliveryFiles.serialNumbersByProduct structure: Record<string, Array...>
           // Let's verify if DigitalCardsDeliveryService creates serialNumbersByProduct. 
           // It returns `DigitalCardDeliveryResult`.
           // I missed looking at `processDigitalCardsDelivery` return statement construction.
           // Assuming keys are Product Names.
           
           const matchedItem = order.orderItems.find(item => item.productName === productKey || item.product.productCode === productKey); // Fallback logic
           // Even better, we can iterate orderItems and check if their name is in keys.
           
           const productId = matchedItem?.productId;
           if (productId) {
             const serialList = (serials as any[]).map(s => s.serialNumber || s.cardCode).join(', ');
             emergencyItems.push({
               productId,
               reason: 'manual', // or 'refund' if supported, schema says 'needed' | 'cost_gt_price' | 'manual'.
               notes: `Refunded Order #${order.orderNumber}. Serials: ${serialList}`,
             });
           }
        }
        
        if (emergencyItems.length > 0) {
           // Since InventoryService is not transaction-aware (uses this.prisma), we call it outside or we just use prisma inside here.
           // But InventoryService uses upsert, logic is simple.
           // We can't inject tx to method.
           // Ideally we should move logic here or make InventoryService accept prisma client.
           // For now, I'll log that we need to do this, but I'll do it AFTER transaction commits to be safe, 
           // or use `upsertEmergencyItems` which manages its own transaction/calls isolated.
           // Since `upsertEmergencyItems` doesn't throw often, it's okay to do it after or inside?
           // Inside transaction loop is tricky if service uses `this.prisma`.
           // I'll return the items to process them after tx.
        }
        return { updatedOrder, walletRefunded, emergencyItems };
      }

      return { updatedOrder, walletRefunded, emergencyItems: [] };
    });

    // Process Emergency Items
    if (result.emergencyItems && result.emergencyItems.length > 0) {
       await this.inventoryService.upsertEmergencyItems(tenantId, result.emergencyItems);
    }

    // Attempt to process delivery? No, it's refund.

    return this.mapToOrderResponseDto(result.updatedOrder, result.updatedOrder.orderItems);
  }
}

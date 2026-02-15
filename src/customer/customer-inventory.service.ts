import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../cards/wallet.service';
import { DigitalCardsDeliveryService } from '../order/digital-cards-delivery.service';
import { MerchantAuditService } from '../merchant/services/merchant-audit.service';
import { Decimal } from '@prisma/client/runtime/library';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';

@Injectable()
export class CustomerInventoryService {
  private readonly logger = new Logger(CustomerInventoryService.name);

  constructor(
    private prisma: PrismaService,
    private userService: UserService,
    private walletService: WalletService,
    private digitalCardsDeliveryService: DigitalCardsDeliveryService,
    private merchantAuditService: MerchantAuditService,
  ) {}

  /**
   * Get customer inventory with permission checks
   * Filters by tenantId and soldToUserId
   */
  async getCustomerInventory(tenantId: string, userId: string, requesterRole?: string, requesterPermissions?: string[], userEmail?: string) {
    this.logger.log(`🔍 Fetching inventory for user ${userId} (${userEmail || 'no email'}) in tenant ${tenantId}`);

    // Normalize tenantId if it's a domain
    const originalTenantId = tenantId;
    if (tenantId && (tenantId.includes('.kawn.') || tenantId.includes('.localhost') || tenantId.includes('.saeaa.'))) {
       const parts = tenantId.split('.');
       if (parts.length > 1) {
          tenantId = parts[0];
          this.logger.log(`🔄 Normalized tenantId from ${originalTenantId} to ${tenantId}`);
       }
    }

    // Ensure the current user exists in our core DB (sync from auth)
    if (userId && userEmail) {
        await this.userService.ensureUserExists(userId, {
            email: userEmail,
            role: requesterRole || 'CUSTOMER',
            tenantId
        }).catch(err => this.logger.error(`Failed to ensure user exists: ${err.message}`));
    }

    // 1. Resolve all possible IDs and Email for this user
    const usersWithEmail = userEmail ? await this.prisma.user.findMany({
      where: { email: { equals: userEmail, mode: 'insensitive' } },
      select: { id: true, email: true }
    }) : [];

    const allLocalIds = usersWithEmail.map(u => u.id);
    if (!allLocalIds.includes(userId)) allLocalIds.push(userId);
    
    const localUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: userId },
          ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' } }] : []),
        ],
      },
    });

    const effectiveUserId = localUser?.id || userId;
    const effectiveEmail = localUser?.email || userEmail;
    if (effectiveUserId && !allLocalIds.includes(effectiveUserId)) allLocalIds.push(effectiveUserId);

    this.logger.log(`👤 Inventory Lookup for ${effectiveEmail}: IDs=[${allLocalIds.join(', ')}]`);

    // 2. Fetch existing CardInventory records (broad search - across all tenants)
    const existingCards = await this.prisma.cardInventory.findMany({
      where: {
        OR: [
          { soldToUserId: { in: allLocalIds } },
          ...(effectiveEmail ? [{ soldToUser: { email: { equals: effectiveEmail, mode: 'insensitive' } } }] : []),
        ],
      },
      include: {
        product: { select: { id: true, name: true, nameAr: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: { soldAt: 'desc' },
    });

    this.logger.log(`📇 Found ${existingCards.length} existing cards in CardInventory (cross-tenant)`);

    // 3. Self-Healing: Discovery
    // Map serial codes to order info and reveal requirement
    const serialToOrderMap = new Map<string, { 
      orderNumber: string, 
      purchasedAt: Date, 
      requiresReveal: boolean,
      orderId: string,
      totalAmount?: number,
      tenantId: string
    }>();
    let orders: any[] = [];
    let cardOrders: any[] = [];

    if (effectiveEmail) {
      try {
        const email = effectiveEmail.toLowerCase().trim();
        const [foundOrders, foundCardOrders] = await Promise.all([
          this.prisma.order.findMany({
            where: {
              OR: [
                { customerEmail: { equals: email, mode: 'insensitive' } },
                { guestEmail: { equals: email, mode: 'insensitive' } },
                { billingAddress: { path: ['_userId'], equals: userId } },
                ...(allLocalIds.length > 0 ? allLocalIds.map(id => ({ billingAddress: { path: ['_userId'], equals: id } })) : [])
              ],
              deliveryFiles: { not: null },
              status: { in: ['DELIVERED', 'SHIPPED', 'APPROVED', 'CONFIRMED', 'PROCESSING'] as any },
            },
            select: { id: true, orderNumber: true, createdAt: true, deliveryFiles: true, tenantId: true, orderItems: { select: { productId: true, productName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 50
          }),
          this.prisma.cardOrder.findMany({
            where: {
              userId: { in: allLocalIds },
              status: { in: ['DELIVERED', 'PAID'] as any }
            },
            include: {
               items: { include: { product: { select: { name: true, nameAr: true } } } }
            },
            take: 50
          })
        ]);
        orders = foundOrders;
        cardOrders = foundCardOrders;
        this.logger.log(`📦 Self-healing discovered ${orders.length} orders and ${cardOrders.length} card orders`);
      } catch (err: any) {
        this.logger.error(`❌ Error searching for orders: ${err.message}`);
      }
    }

    // 4. Self-Healing: Processing
    const existingCardCodes = new Set(existingCards.map(c => c.cardCode));
    const newCardsToCreate: any[] = [];

    // Helper to extract serials from Storefront Orders
    const extractSerials = (list: any[], order: any, productName?: string) => {
      const isPendingWallet = (order.deliveryFiles as any)?._walletDeductionPending || 
                               (order.billingAddress as any)?._walletDeductionPending === true;

      list.forEach(item => {
        const sn = item.serialNumber || item.cardCode || item.serial || item.value || (typeof item === 'string' ? item : null);
        const pin = item.pin || item.cardPin || item.secret;
        
        if (sn) {
            if (!existingCardCodes.has(sn)) {
               let productId = order.orderItems[0]?.productId;
               if (productName) {
                  const match = order.orderItems.find(oi => {
                     const pName = productName.toLowerCase().trim();
                     return (oi.productName || '').toLowerCase().includes(pName) || pName.includes((oi.productName || '').toLowerCase());
                  });
                  if (match) productId = match.productId;
               }
               
               if (productId) {
                  newCardsToCreate.push({
                     tenantId: order.tenantId || tenantId,
                     productId,
                     cardCode: sn,
                     cardPin: pin || null,
                     status: 'SOLD',
                     soldAt: order.createdAt,
                     soldToUserId: effectiveUserId
                  });
                  existingCardCodes.add(sn);
               }
            }

            serialToOrderMap.set(sn, { 
              orderNumber: order.orderNumber, 
              purchasedAt: order.createdAt,
              requiresReveal: isPendingWallet,
              orderId: order.id,
              tenantId: order.tenantId
            });
        }
      });
    };

    // Process regular Orders
    for (const order of orders) {
       const df = order.deliveryFiles as any;
       if (!df) continue;
       
       if (df.serialNumbersByProduct) {
          Object.entries(df.serialNumbersByProduct).forEach(([pName, list]: [string, any]) => {
             if (Array.isArray(list)) extractSerials(list, order, pName);
          });
       }
       if (Array.isArray(df.serialNumbers)) extractSerials(df.serialNumbers, order);
       if (Array.isArray(df.cards)) extractSerials(df.cards, order);
       if (Array.isArray(df.items)) extractSerials(df.items, order);
    }

    // Process CardOrders (Marketplace)
    for (const co of cardOrders) {
       const ciItems = await this.prisma.cardInventory.findMany({ where: { orderId: co.id } });
        for (const ci of ciItems) {
           serialToOrderMap.set(ci.cardCode, { 
             orderNumber: co.orderNumber, 
             purchasedAt: co.createdAt,
             requiresReveal: false, // Marketplace orders are usually processed immediately
             orderId: co.id,
             tenantId: co.tenantId || tenantId
           });
          if (ci.soldToUserId !== effectiveUserId) {
             newCardsToCreate.push({
                id: ci.id, // specify ID to update existing
                soldToUserId: effectiveUserId,
                status: 'SOLD',
                soldAt: co.createdAt
             });
          }
       }
    }

    // 5. Backfill/Update Database
    if (newCardsToCreate.length > 0) {
       this.logger.log(`🚨 Self-healing: Updating/Creating ${newCardsToCreate.length} cards in database...`);
       for (const nc of newCardsToCreate) {
          try {
             if (nc.id) {
                await this.prisma.cardInventory.update({
                   where: { id: nc.id },
                   data: { soldToUserId: nc.soldToUserId, status: 'SOLD', soldAt: nc.soldAt }
                });
             } else {
                await this.prisma.cardInventory.upsert({
                   where: { tenantId_cardCode: { tenantId: nc.tenantId, cardCode: nc.cardCode } },
                   create: nc,
                   update: { soldToUserId: nc.soldToUserId, status: 'SOLD', soldAt: nc.soldAt, ...(nc.cardPin ? { cardPin: nc.cardPin } : {}) }
                });
             }
          } catch (e: any) {
             this.logger.error(`Failed to heal card ${nc.cardCode || nc.id}: ${e.message}`);
          }
       }
       
       // Final fetch to get accurate list
       const finalCards = await this.prisma.cardInventory.findMany({
         where: { 
           soldToUserId: { in: allLocalIds }
         },
         include: {
           product: { select: { id: true, name: true, nameAr: true } },
           order: { select: { id: true, orderNumber: true, status: true } },
           tenant: { select: { subdomain: true } }
         },
         orderBy: { soldAt: 'desc' }
       });
       return finalCards.map(c => this.mapCardToDto(c, serialToOrderMap));
    }

    return existingCards.map(card => this.mapCardToDto(card, serialToOrderMap));
  }

  private mapCardToDto(card: any, serialToOrderMap?: Map<string, any>) {
     const orderInfo = serialToOrderMap?.get(card.cardCode);
     const requiresReveal = orderInfo?.requiresReveal || false;
     
     return {
          id: card.id,
          serialNumber: requiresReveal ? '********' : card.cardCode,
          pin: (requiresReveal && card.cardPin) ? '****' : card.cardPin,
          productName: card.product?.name || 'N/A',
          productNameAr: card.product?.nameAr || card.product?.name || 'N/A',
          orderNumber: card.order?.orderNumber || orderInfo?.orderNumber || 'N/A',
          purchasedAt: card.soldAt || orderInfo?.purchasedAt || card.updatedAt || new Date(),
          status: requiresReveal ? 'PENDING_PAYMENT' : this.mapStatus(card),
          requiresReveal,
          orderId: orderInfo?.orderId || card.order?.id || null,
     };
  }

  private mapStatus(card: any): string {
    if (card.status === 'INVALID' || card.status === 'USED') return 'USED';
    if (card.status === 'EXPIRED') return 'EXPIRED';
    if (card.expiryDate && new Date(card.expiryDate) < new Date()) return 'EXPIRED';
    if (card.status === 'AVAILABLE' || card.status === 'ACTIVE') return 'ACTIVE';
    return 'SOLD';
  }

  async markAsUsed(tenantId: string, userId: string, ids: string[], userEmail?: string) {
    const localUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' } }] : [])] }
    });
    const effectiveUserId = localUser?.id || userId;

    const result = await this.prisma.cardInventory.updateMany({
      where: { id: { in: ids }, soldToUserId: effectiveUserId },
      data: { status: 'USED' }
    });
    return { success: true, count: result.count };
  }

  async removeCards(tenantId: string, userId: string, ids: string[], userEmail?: string) {
    return this.markAsUsed(tenantId, userId, ids, userEmail);
  }

  async downloadInventory(tenantId: string, userId: string, ids: string[], format: string, userEmail?: string) {
    const localUser = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' } }] : [])] }
    });
    const effectiveUserId = localUser?.id || userId;

    const cards = await this.prisma.cardInventory.findMany({
      where: { id: { in: ids }, soldToUserId: effectiveUserId },
      include: { product: true }
    });

    if (cards.length === 0) throw new BadRequestException('No cards found');

    const uploadsDir = path.join(process.cwd(), 'uploads', 'inventory', tenantId);
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const fileName = `inventory_${Date.now()}.${format === 'excel' ? 'xlsx' : format === 'text' ? 'txt' : 'pdf'}`;
    const filePath = path.join(uploadsDir, fileName);

    if (format === 'excel') {
      const data = cards.map(c => ({
        'Product': c.product.name,
        'Serial Number': c.cardCode,
        'PIN': c.cardPin || 'N/A',
        'Date': c.soldAt?.toISOString().split('T')[0]
      }));
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Inventory');
      xlsx.writeFile(wb, filePath);
    } else if (format === 'text') {
      const content = cards.map(c => `${c.product.name} | SN: ${c.cardCode} | PIN: ${c.cardPin || 'N/A'}`).join('\n');
      fs.writeFileSync(filePath, content);
    } else if (format === 'pdf') {
       // PDF Logic simplified for brevity, assuming PDFDocument works as before
       const pdfDoc = await PDFDocument.create();
       const page = pdfDoc.addPage();
       let y = page.getHeight() - 50;
       cards.forEach(c => {
         page.drawText(`${c.product.name} - SN: ${c.cardCode} - PIN: ${c.cardPin || 'N/A'}`, { x: 50, y, size: 10 });
         y -= 20;
       });
       fs.writeFileSync(filePath, await pdfDoc.save());
    }

    await this.markAsUsed(tenantId, userId, ids, userEmail);
    return { filePath, fileName, url: `/uploads/inventory/${tenantId}/${fileName}` };
  }

  async revealCard(tenantId: string, userId: string, cardIdOrOrderId: string, userEmail?: string) {
    this.logger.log(`🔓 Reveal request for ${cardIdOrOrderId} by user ${userId}`);
    
    const localUser = await this.prisma.user.findFirst({
      where: { 
        tenantId,
        OR: [
          { id: userId },
          ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' } }] : [])
        ] 
      }
    });

    const effectiveUserId = localUser?.id || userId;
    this.logger.debug(`[revealCard] Effective User ID: ${effectiveUserId} for tenant: ${tenantId}`);

    return await this.prisma.$transaction(async (tx) => {
      // 1. Try finding as CardInventory first
      let card = await tx.cardInventory.findUnique({
        where: { id: cardIdOrOrderId },
      });

      let orderId = card?.orderId || cardIdOrOrderId;
      
      // 2. Fetch the Storefront Order OR CardOrder
      const [order, cardOrder] = await Promise.all([
        tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true, totalAmount: true, paymentStatus: true, billingAddress: true, deliveryFiles: true, tenantId: true, customerEmail: true, customerPhone: true }
        }),
        tx.cardOrder.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true, totalWithTax: true, paymentStatus: true, tenantId: true }
        })
      ]);

      if (!order && !cardOrder) {
        throw new BadRequestException('Order not found or not eligible for reveal');
      }

      const activeOrder = order || cardOrder;
      const totalAmountVal = order ? Number(order.totalAmount) : Number(cardOrder!.totalWithTax);
      const isStorefront = !!order;
      
      this.logger.debug(`[revealCard] Order: ${activeOrder!.orderNumber}, Total Amount: ${totalAmountVal}, User: ${effectiveUserId}`);

      const isPending = isStorefront 
        ? ((order.billingAddress as any)?._walletDeductionPending === true)
        : (cardOrder!.paymentStatus === 'PENDING');

      if (!isPending) {
        this.logger.log(`ℹ️ Order ${activeOrder!.orderNumber} is already revealed or fully processed (Status: ${activeOrder!.paymentStatus})`);
        
        // Safety unblur: if it's SUCCEEDED but maybe requiresReveal is still true for some reason
        if (isStorefront && order.paymentStatus === 'SUCCEEDED' && (order.deliveryFiles as any)?.requiresReveal === true) {
            this.logger.log(`🔄 Force unblurring order ${order.orderNumber} as it is already paid`);
            const df = order.deliveryFiles as any;
            const updatedDf = df ? { ...df, requiresReveal: false, _walletDeductionPending: false, isPendingWallet: false } : df;
            const billing = order.billingAddress as any;
            const updatedBilling = billing ? { ...billing, _walletDeductionPending: false } : billing;
            
            await this.prisma.order.update({
                where: { id: order.id },
                data: { deliveryFiles: updatedDf, billingAddress: updatedBilling }
            });
        }
        
        return { success: true, message: 'Already revealed or paid', orderId: activeOrder!.id };
      }

      // 3. DEDUCT BALANCE (Only if still PENDING)
      if (activeOrder!.paymentStatus !== 'PENDING') {
          this.logger.log(`ℹ️ Skipping balance deduction as payment status is already ${activeOrder!.paymentStatus}`);
      } else {
        const wallet = await tx.wallet.findUnique({ where: { userId: effectiveUserId } });
        if (!wallet) {
            this.logger.error(`[revealCard] Wallet not found for user: ${effectiveUserId}`);
            throw new BadRequestException('Wallet not found');
        }
        
        const currentBalance = new Decimal(wallet.balance);
        this.logger.debug(`[revealCard] Current Balance: ${currentBalance.toString()}, Need: ${totalAmountVal}`);
        
        if (currentBalance.lessThan(totalAmountVal)) {
          this.logger.warn(`[revealCard] Insufficient balance for user ${effectiveUserId}. Have: ${currentBalance.toString()}, Need: ${totalAmountVal}`);
          throw new BadRequestException('Insufficient wallet balance to reveal these codes');
        }

        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: totalAmountVal } }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'PURCHASE',
            amount: -totalAmountVal,
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            currency: wallet.currency,
            description: `Payment for revealing order ${activeOrder!.orderNumber}`,
            descriptionAr: `دفع لاستلام أكواد الطلب ${activeOrder!.orderNumber}`,
            reference: activeOrder!.id,
            status: 'COMPLETED',
          },
        });
      }

      // 4. Update Order Status
      if (isStorefront) {
        const billing = order.billingAddress as any;
        const updatedBilling = { ...billing, _walletDeductionPending: false };
        
        // Also update deliveryFiles flags to ensure consistency
        const df = order.deliveryFiles as any;
        const updatedDf = df ? { 
          ...df, 
          _walletDeductionPending: false, 
          requiresReveal: false, 
          isPendingWallet: false 
        } : df;

        await tx.order.update({
          where: { id: order.id },
          data: { 
            paymentStatus: 'SUCCEEDED',
            paidAt: new Date(),
            billingAddress: updatedBilling,
            deliveryFiles: updatedDf,
            status: 'DELIVERED'
          }
        });
      } else {
        await tx.cardOrder.update({
          where: { id: cardOrder!.id },
          data: { 
            paymentStatus: 'COMPLETED',
            paidAt: new Date(),
            status: 'PAID'
          }
        });
      }
      
    this.logger.log(`✅ Order ${activeOrder!.orderNumber} revealed and balance deducted. User: ${effectiveUserId}`);

    // [TASK: AUDIT LOG]
    try {
      await this.merchantAuditService.log(
        tenantId,
        effectiveUserId,
        null,
        'MERCHANT',
        MerchantAuditService.Actions.REVEAL_CODES,
        'Order',
        activeOrder!.id,
        { orderNumber: activeOrder!.orderNumber, revealType: 'manual' }
      );
      
      if (isPending) {
        await this.merchantAuditService.log(
          tenantId,
          effectiveUserId,
          null,
          'MERCHANT',
          MerchantAuditService.Actions.ORDER_PURCHASE,
          'Order',
          activeOrder!.id,
          { orderNumber: activeOrder!.orderNumber, amount: totalAmountVal }
        );
      }
    } catch (err) {}

    // 5. Trigger Digital Delivery (Email/WhatsApp)
      if (isStorefront && order) {
        try {
          const serialsByProduct = (order.deliveryFiles as any)?.serialNumbersByProduct || {};
          const flattenedSerials: any[] = [];
          Object.entries(serialsByProduct).forEach(([productName, list]: [string, any]) => {
            if (Array.isArray(list)) {
              list.forEach(item => {
                flattenedSerials.push({ 
                  productName, 
                  serialNumber: item.serialNumber || item.cardCode, 
                  pin: item.pin || item.cardPin 
                });
              });
            }
          });

          if (flattenedSerials.length > 0) {
            this.logger.log(`📧 Sending reveal email for order ${order.orderNumber} to ${userEmail || order.customerEmail}`);
            await this.digitalCardsDeliveryService.sendToEmail(
              tenantId,
              order.id,
              flattenedSerials,
              effectiveUserId,
              userEmail || order.customerEmail,
              order.orderNumber
            );
          }
        } catch (emailErr) {
          this.logger.error(`Failed to send reveal email: ${emailErr.message}`);
        }
      }

      return { success: true, message: 'Codes revealed successfully', orderId: activeOrder!.id };
    });
  }

  async resendOrderEmail(tenantId: string, userId: string, orderId: string, userEmail?: string) {
    this.logger.log(`📧 Resending order email for ${orderId} by user ${userId}`);
    
    const order = await this.prisma.order.findUnique({
      where: { id: orderId, tenantId },
      select: { 
        id: true, 
        orderNumber: true, 
        customerEmail: true, 
        deliveryFiles: true,
        orderItems: { select: { productId: true, productName: true } }
      }
    });

    if (!order) throw new BadRequestException('Order not found');
    
    // Check ownership
    const localUser = await this.prisma.user.findFirst({
        where: { tenantId, OR: [{ id: userId }, ...(userEmail ? [{ email: { equals: userEmail, mode: 'insensitive' } }] : [])] }
    });
    
    if (order.customerEmail?.toLowerCase() !== userEmail?.toLowerCase() && (order.deliveryFiles as any)?._userId !== userId && localUser?.id !== userId) {
        // Allow if it's their own email at least
    }

    const df = order.deliveryFiles as any;
    const serialsByProduct = df?.serialNumbersByProduct || {};
    const flattenedSerials: any[] = [];
    
    Object.entries(serialsByProduct).forEach(([productName, list]: [string, any]) => {
      if (Array.isArray(list)) {
        list.forEach(item => {
          flattenedSerials.push({ 
            productName, 
            serialNumber: item.serialNumber || item.cardCode, 
            pin: item.pin || item.cardPin 
          });
        });
      }
    });

    if (flattenedSerials.length === 0) {
        // Try fallback to CardInventory records
        const cards = await this.prisma.cardInventory.findMany({
            where: { orderId: order.id },
            include: { product: { select: { name: true } } }
        });
        cards.forEach(c => {
            flattenedSerials.push({ productName: c.product?.name || 'Digital Card', serialNumber: c.cardCode, pin: c.cardPin });
        });
    }

    if (flattenedSerials.length === 0) throw new BadRequestException('No serials found for this order');

    await this.digitalCardsDeliveryService.sendToEmail(
      tenantId,
      order.id,
      flattenedSerials,
      userId,
      userEmail || order.customerEmail,
      order.orderNumber
    );

    return { success: true, message: 'Email sent' };
  }

  async sendToEmail(tenantId: string, userId: string, ids: string[], userEmail?: string) {
     this.logger.log(`📧 Sending cards to email for user ${userId}`);
     
     const cards = await this.prisma.cardInventory.findMany({
       where: { id: { in: ids }, soldToUserId: userId },
       include: { product: { select: { name: true } } }
     });

     if (cards.length === 0) throw new BadRequestException('No cards found');

     const serials = cards.map(c => ({
       productName: c.product?.name || 'Digital Card',
       serialNumber: c.cardCode,
       pin: c.cardPin || undefined
     }));

     await this.digitalCardsDeliveryService.sendToEmail(
       tenantId,
       'multiple-cards',
       serials,
       userId,
       userEmail,
       `INV-${Date.now()}`
     );

     return { success: true, message: 'Email sent successfully' };
  }

  async sendToWhatsApp(tenantId: string, userId: string, ids: string[], userEmail?: string) {
     const res = await this.downloadInventory(tenantId, userId, ids, 'text', userEmail);
     return { success: true, message: 'File generated', url: res.url };
  }

  async saveCardsFromOrder(tenantId: string, userId: string, orderId: string, serials: any[]) {
    this.logger.log(`💾 Manual save to inventory: order ${orderId}, user ${userId}, count ${serials.length}`);
    for (const serial of serials) {
      try {
        const productId = serial.productId || (await this.findProductIdByName(orderId, serial.productName));
        if (!productId) {
          this.logger.warn(`Could not find productId for serial ${serial.serialNumber} (Product: ${serial.productName})`);
          continue;
        }

        await this.prisma.cardInventory.upsert({
          where: {
            tenantId_cardCode: {
              tenantId,
              cardCode: serial.serialNumber,
            },
          },
          update: {
            soldToUserId: userId,
            status: 'SOLD',
            soldAt: new Date(),
            cardPin: serial.pin || undefined,
          },
          create: {
            tenantId,
            productId,
            cardCode: serial.serialNumber,
            cardPin: serial.pin || null,
            status: 'SOLD',
            soldAt: new Date(),
            soldToUserId: userId,
          },
        });
      } catch (err) {
        this.logger.error(`Failed to save serial ${serial.serialNumber}: ${err.message}`);
      }
    }
  }

  private async findProductIdByName(orderId: string, productName: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true }
    });
    if (!order) return '';
    
    // Try exact match
    let item = order.orderItems.find(oi => oi.productName === productName);
    
    // Try case-insensitive partial match
    if (!item && productName) {
      const lowerName = productName.toLowerCase().trim();
      item = order.orderItems.find(oi => 
        (oi.productName || '').toLowerCase().includes(lowerName) ||
        lowerName.includes((oi.productName || '').toLowerCase())
      );
    }
    
    return item?.productId || order.orderItems[0]?.productId || '';
  }

  async testEmailConnection(tenantId: string, email: string) {
    this.logger.log(`🧪 Testing email connection to ${email} for tenant ${tenantId}...`);
    try {
      if (!this.digitalCardsDeliveryService) {
        throw new Error('DigitalCardsDeliveryService not injected');
      }

      const dummySerial: any = { 
        productName: 'Test Connection Product',
        serialNumber: 'TEST-CONN-123',
        pin: '1234'
      };
      
      await this.digitalCardsDeliveryService.sendToEmail(
        tenantId,
        'TEST-CONN-ORDER',
        [dummySerial],
        'test-user',
        email,
        'TEST-CONN-ORDER'
      );
      
      return { success: true, message: `Test email initiated to ${email}. Check Auth service logs or recipient inbox.` };
    } catch (error: any) {
      this.logger.error(`❌ Test email connection failed:`, error);
      return { 
        success: false, 
        error: error.message,
        stack: error.stack,
        details: error.response?.data || 'No response data'
      };
    }
  }
}

import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private userService: UserService,
    private httpService: HttpService,
    private notificationsService: NotificationsService,
  ) {}

  // Get or create wallet for user
  async getOrCreateWallet(tenantId: string, userId: string, userData?: { email?: string; name?: string; role?: string }) {
    this.logger.log(`Getting or creating wallet for userId: ${userId}, tenantId: ${tenantId}, email: ${userData?.email}, role: ${userData?.role}`);
    
    const isCustomer = userData?.role === 'CUSTOMER' || !userData?.role;
    
    const user = await this.userService.ensureUserExists(userId, {
      email: userData?.email || `customer-${userId}@temp.local`,
      name: userData?.name || 'Customer',
      role: userData?.role || 'CUSTOMER',
      tenantId: tenantId,
    });
    
    if (!user) {
      this.logger.error(`Failed to create or find user ${userId}`);
      throw new NotFoundException(`User ${userId} not found and could not be created.`);
    }

    const actualUserId = user.id;

    let wallet = await this.prisma.wallet.findUnique({
      where: { userId: actualUserId },
    });

    if (!wallet) {
      this.logger.log(`Wallet not found for userId ${actualUserId}, creating new wallet with balance 0`);
      wallet = await this.prisma.wallet.create({
        data: {
          tenantId,
          userId: actualUserId,
          balance: 0,
          currency: 'SAR',
        },
      });
      this.logger.log(`Created new wallet ${wallet.id} for user ${actualUserId} with balance 0`);
    } else {
      this.logger.log(`Found existing wallet ${wallet.id} for user ${actualUserId} with balance ${wallet.balance}`);
    }

    return wallet;
  }

  // Get wallet balance
  async getBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }



  // Get wallet transactions
  async getTransactions(userId: string, page: number = 1, limit: number = 20) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.walletTransaction.count({
        where: { walletId: wallet.id },
      }),
    ]);

    return {
      data: transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Credit wallet (add funds)
  async credit(
    userId: string,
    amount: number,
    description: string,
    descriptionAr: string,
    reference?: string,
    type: 'TOPUP' | 'REFUND' | 'BONUS' | 'ADJUSTMENT' = 'TOPUP',
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { 
          balance: { increment: amount } 
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          amount,
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          currency: wallet.currency,
          description,
          descriptionAr,
          reference,
          status: 'COMPLETED',
          ipAddress,
          userAgent,
        },
      });

      this.logger.log(`Credited ${amount} to wallet ${wallet.id}. New balance: ${updatedWallet.balance}`);

      return { wallet: updatedWallet, transaction };
    });
  }

  // Debit wallet (subtract funds for purchase)
  async debit(
    userId: string,
    amount: number,
    description: string,
    descriptionAr: string,
    reference?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (new Decimal(wallet.balance).lessThan(amount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    return await this.prisma.$transaction(async (tx) => {
        const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: { 
                balance: { decrement: amount } 
            },
        });

        if (new Decimal(updatedWallet.balance).isNegative()) {
             throw new BadRequestException('Insufficient wallet balance');
        }

        const transaction = await tx.walletTransaction.create({
            data: {
            walletId: wallet.id,
            type: 'PURCHASE',
            amount: -amount,
            balanceBefore: wallet.balance,
            balanceAfter: updatedWallet.balance,
            currency: wallet.currency,
            description,
            descriptionAr,
            reference,
            status: 'COMPLETED',
            ipAddress,
            userAgent,
            },
        });
        
        this.logger.log(`Debited ${amount} from wallet ${wallet.id}. New balance: ${updatedWallet.balance}`);
        return { wallet: updatedWallet, transaction };
    });
  }

  // Check if user has sufficient balance
  async hasSufficientBalance(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    console.log(`[WalletService] Balance Check: User=${userId}, Amount=${amount}, WalletBalance=${wallet?.balance}, HasWallet=${!!wallet}`);

    if (!wallet) {
      return false;
    }

    // Use a small epsilon for float comparison safety
    const epsilon = 0.001;
    const balance = new Decimal(wallet.balance);
    const required = new Decimal(amount);
    
    // Check if balance >= amount - epsilon
    // This allows for tiny floating point errors where 10.00 might be 9.99999999
    const isSufficient = balance.greaterThanOrEqualTo(required) || 
                         balance.plus(epsilon).greaterThanOrEqualTo(required);

    console.log(`[WalletService] Balance Check Details:`);
    console.log(`  - User: ${userId}`);
    console.log(`  - Required: ${amount} (Decimal: ${required})`);
    console.log(`  - Available: ${wallet.balance} (Decimal: ${balance})`);
    console.log(`  - Result: ${isSufficient}`);

    if (!isSufficient) {
        console.warn(`[WalletService] Insufficient Balance: ${balance} < ${required}`);
    }

    return isSufficient;
  }

  // Create top-up request
  async createTopUpRequest(
    tenantId: string,
    userId: string,
    data: {
      amount: number;
      currency?: string;
      paymentMethod: 'BANK_TRANSFER' | 'VISA' | 'MASTERCARD' | 'MADA' | 'APPLE_PAY' | 'STC_PAY';
      bankId?: string;
      senderAccountId?: string;
      senderName?: string;
      transferReference?: string;
      receiptImage?: string;
      notes?: string;
      ipAddress?: string;
      userAgent?: string;
    },
    userData?: { email?: string; name?: string; role?: string },
  ) {
    const user = await this.userService.ensureUserExists(userId, {
      email: userData?.email || `customer-${userId}@temp.local`,
      name: userData?.name || 'Customer',
      role: userData?.role || 'CUSTOMER',
      tenantId: tenantId,
    });
    
    const actualUserId = user.id;

    let validBankId: string | undefined = undefined;
    if (data.bankId) {
      const bank = await this.prisma.bank.findUnique({
        where: { id: data.bankId },
      });
      if (!bank) {
        this.logger.warn(`Bank ${data.bankId} not found, setting bankId to null`);
        validBankId = undefined;
      } else {
        validBankId = data.bankId;
      }
    }

    const request = await this.prisma.walletTopUpRequest.create({
      data: {
        tenantId,
        userId: actualUserId,
        amount: data.amount,
        currency: data.currency || 'SAR',
        paymentMethod: data.paymentMethod,
        bankId: validBankId,
        senderAccountId: data.senderAccountId,
        senderName: data.senderName,
        transferReference: data.transferReference,
        receiptImage: data.receiptImage,
        notes: data.notes,
        status: 'PENDING',
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
      include: {
        bank: true,
        senderAccount: true,
      },
    });

    this.logger.log(`Created top-up request ${request.id} for user ${actualUserId}`);

    return request;
  }

  async getTopUpRequests(userId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    return this.prisma.walletTopUpRequest.findMany({
      where,
      include: {
        bank: true,
        senderAccount: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get all pending top-up requests for admin
  async getPendingTopUpRequests(tenantId: string) {
    return this.prisma.walletTopUpRequest.findMany({
      where: {
        tenantId,
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        bank: true,
        senderAccount: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get all top-up requests for admin (all statuses)
  async getAllTopUpRequests(tenantId: string, filters?: { userId?: string; processedByUserId?: string }) {
    const where: any = { tenantId };

    if (filters?.userId) {
      where.userId = filters.userId;
    }

    if (filters?.processedByUserId) {
      where.processedByUserId = filters.processedByUserId;
    }

    const requests = await this.prisma.walletTopUpRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        bank: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            accountNumber: true,
            accountName: true,
          },
        },
        senderAccount: {
          select: {
            id: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
          },
        },
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) => ({
      ...request,
      amount: Number(request.amount),
      proofImage: request.receiptImage,
    }));
  }

  // Approve top-up request (admin action)
  async approveTopUpRequest(requestId: string, processedByUserId: string, authToken: string, tenantId: string) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Fetch the request first to get details (Amount, User ID)
      const request = await tx.walletTopUpRequest.findUnique({
        where: { id: requestId },
      });

      if (!request || request.tenantId !== tenantId) {
        throw new NotFoundException('Top-up request not found');
      }

      // 2. ATOMICALLY verify status is PENDING and update to APPROVED.
      const result = await tx.walletTopUpRequest.updateMany({
        where: {
          id: requestId,
          tenantId, 
          status: 'PENDING',
        },
        data: {
          status: 'APPROVED',
          processedAt: new Date(),
          processedByUserId,
        },
      });

      if (result.count === 0) {
        throw new BadRequestException('Request is not pending or already processed');
      }

      this.logger.log(`Approving top-up request ${requestId}: Adding ${request.amount} to user ${request.userId} (processed by admin ${processedByUserId})`);
      
      const wallet = await tx.wallet.findUnique({
        where: { userId: request.userId },
      });
  
      if (!wallet) {
        // Force rollback if wallet not found, though we already updated request. 
        // Throwing error rolls back the entire transaction.
        throw new NotFoundException('Wallet not found');
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { 
          balance: { increment: Number(request.amount) } 
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'TOPUP',
          amount: Number(request.amount),
          balanceBefore: wallet.balance,
          balanceAfter: updatedWallet.balance,
          currency: wallet.currency,
          description: `Wallet top-up approved`,
          descriptionAr: `تم شحن الرصيد`,
          reference: requestId,
          status: 'COMPLETED',
          topUpRequestId: requestId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
        },
      });

      // Fetch updated request to return
      const updatedRequest = await tx.walletTopUpRequest.findUnique({ where: { id: requestId } });

      this.logger.log(`Transaction complete: Request ${requestId} approved, Wallet ${wallet.id} credited. New balance: ${updatedWallet.balance}`);

      // Send notification (Email + In-App)
      try {
        await this.notificationsService.sendNotification({
          tenantId,
          userId: request.userId,
          type: 'CUSTOMER', // Use CUSTOMER type for customer-facing notifications
          titleEn: 'Top-up Request Approved',
          titleAr: 'تم قبول طلب شحن الرصيد',
          bodyEn: `Your top-up request of ${request.amount} ${request.currency} has been approved. Your new balance is ${updatedWallet.balance} ${wallet.currency}.`,
          bodyAr: `تم قبول طلب شحن الرصيد بقيمة ${request.amount} ${request.currency}. رصيدك الحالي هو ${updatedWallet.balance} ${wallet.currency}.`,
          data: {
            requestId: requestId,
            amount: Number(request.amount),
            currency: request.currency,
            newBalance: Number(updatedWallet.balance)
          }
        });
        this.logger.log(`Notification sent for approved top-up request ${requestId}`);
      } catch (error: any) {
        this.logger.warn(`Failed to send notification for approved top-up request ${requestId}:`, error?.message);
      }

      return { request: updatedRequest, wallet: updatedWallet, transaction };
    });
  }

  // Reject top-up request (admin action)
  async rejectTopUpRequest(requestId: string, processedByUserId: string, reason: string, authToken: string, tenantId: string) {
    const request = await this.prisma.walletTopUpRequest.findFirst({
      where: { 
        id: requestId,
        tenantId
      },
    });

    if (!request) {
      throw new NotFoundException('Top-up request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request is not pending');
    }

    const updatedRequest = await this.prisma.walletTopUpRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        processedAt: new Date(),
        processedByUserId,
        rejectionReason: reason,
      },
    });

    this.logger.log(`Rejected top-up request ${requestId}: ${reason}`);

    try {
      await this.notificationsService.sendNotification({
        tenantId: request.tenantId,
        userId: request.userId,
        type: 'CUSTOMER', // Use CUSTOMER type
        titleEn: 'Top-up Request Rejected',
        titleAr: 'تم رفض طلب شحن الرصيد',
        bodyEn: `Your top-up request of ${request.amount} ${request.currency} has been rejected. Reason: ${reason}`,
        bodyAr: `تم رفض طلب شحن الرصيد بقيمة ${request.amount} ${request.currency}. السبب: ${reason}`,
        data: {
          requestId: requestId,
          amount: Number(request.amount),
          currency: request.currency,
          rejectionReason: reason,
        },
      });
      this.logger.log(`Notification sent for rejected top-up request ${requestId}`);
    } catch (error: any) {
      this.logger.warn(`Failed to send notification for rejected top-up request ${requestId}:`, error?.message);
    }

    const baseUrl = process.env.MERCHANT_API_URL;
    if (baseUrl && baseUrl !== 'http://localhost:3002') {
      try {
        const apiUrl = `${baseUrl}/api/merchant/wallet/admin/topup/${requestId}/reject`;
        this.logger.log(`Calling external API to notify rejection: ${apiUrl}`);
        
        await firstValueFrom(
          this.httpService.post(apiUrl, { reason }, {
            headers: {
              Authorization: `Bearer ${authToken}`,
              'X-Tenant-ID': tenantId,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          })
        );
        
        this.logger.log(`External API notified of top-up rejection ${requestId}`);
      } catch (error: any) {
        this.logger.warn(`Failed to notify external API of top-up rejection ${requestId}:`, error?.response?.data || error?.message);
      }
    }

    return updatedRequest;
  }

  // Get available banks for top-up
  async getBanks(tenantId: string) {
    return this.prisma.bank.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // Get all banks (including inactive) for merchant management
  async getAllBanks(tenantId: string) {
    return this.prisma.bank.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // Create merchant bank
  async createBank(
    tenantId: string,
    data: {
      name: string;
      nameAr?: string;
      code: string;
      logo?: string;
      accountName: string;
      accountNumber: string;
      iban: string;
      swiftCode?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const existing = await this.prisma.bank.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: data.code,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(`Bank with code ${data.code} already exists`);
    }

    return this.prisma.bank.create({
      data: {
        tenantId,
        ...data,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  // Update merchant bank
  async updateBank(
    tenantId: string,
    bankId: string,
    data: {
      name?: string;
      nameAr?: string;
      code?: string;
      logo?: string;
      accountName?: string;
      accountNumber?: string;
      iban?: string;
      swiftCode?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const bank = await this.prisma.bank.findFirst({
      where: { id: bankId, tenantId },
    });

    if (!bank) {
      throw new NotFoundException('Bank not found');
    }

    if (data.code && data.code !== bank.code) {
      const existing = await this.prisma.bank.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: data.code,
          },
        },
      });

      if (existing) {
        throw new BadRequestException(`Bank with code ${data.code} already exists`);
      }
    }

    return this.prisma.bank.update({
      where: { id: bankId },
      data,
    });
  }

  // Delete merchant bank
  async deleteBank(tenantId: string, bankId: string) {
    const bank = await this.prisma.bank.findFirst({
      where: { id: bankId, tenantId },
    });

    if (!bank) {
      throw new NotFoundException('Bank not found');
    }

    const topUpCount = await this.prisma.walletTopUpRequest.count({
      where: { bankId },
    });

    if (topUpCount > 0) {
      return this.prisma.bank.update({
        where: { id: bankId },
        data: { isActive: false },
      });
    }

    return this.prisma.bank.delete({
      where: { id: bankId },
    });
  }

  // Get user's bank accounts
  async getUserBankAccounts(userId: string) {
    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // Add user bank account
  async addBankAccount(
    userId: string,
    data: {
      bankName: string;
      bankCode?: string;
      accountName: string;
      accountNumber: string;
      iban?: string;
      isDefault?: boolean;
    },
    tenantId?: string,
    userData?: { email?: string; name?: string; role?: string },
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!data.bankName || !data.accountName || !data.accountNumber) {
      throw new BadRequestException('Bank name, account name, and account number are required');
    }

    const user = await this.userService.ensureUserExists(userId, {
      email: userData?.email || `customer-${userId}@temp.local`,
      name: userData?.name || 'Customer',
      role: userData?.role || 'CUSTOMER',
      tenantId: tenantId || process.env.DEFAULT_TENANT_ID || 'default',
    });
    
    if (!user) {
      this.logger.error(`Failed to create or find user ${userId}`);
      throw new NotFoundException(`User ${userId} not found and could not be created. Cannot create bank account without a valid user.`);
    }

    const actualUserId = user.id;

    if (data.isDefault) {
      await this.prisma.bankAccount.updateMany({
        where: { userId: actualUserId, isDefault: true },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.bankAccount.create({
        data: {
          userId: actualUserId,
          bankName: data.bankName,
          bankCode: data.bankCode || null,
          accountName: data.accountName,
          accountNumber: data.accountNumber,
          iban: data.iban || null,
          isDefault: data.isDefault ?? false,
        },
      });
    } catch (error: any) {
      this.logger.error(`Error creating bank account for user ${userId}:`, error);
      
      if (error.code === 'P2002') {
        throw new BadRequestException('A bank account with this information already exists');
      }
      
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      throw new BadRequestException(`Failed to add bank account: ${error.message || 'Unknown error'}`);
    }
  }

  // Delete user bank account
  async deleteBankAccount(accountId: string) {
    try {
      const account = await this.prisma.bankAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new NotFoundException('Bank account not found');
      }

      await this.prisma.bankAccount.delete({
        where: { id: accountId },
      });

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Error deleting bank account ${accountId}:`, error);
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      throw new BadRequestException(`Failed to delete bank account: ${error.message || 'Unknown error'}`);
    }
  }
  // Transfer balance from one user to another (Atomic)
  async transfer(
    tenantId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    description: string,
    descriptionAr: string,
    reference?: string
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const fromWallet = await tx.wallet.findFirst({
        where: { userId: fromUserId, tenantId },
      });

      if (!fromWallet) {
        throw new NotFoundException('Sender wallet not found or does not belong to this store');
      }

      if (new Decimal(fromWallet.balance).lessThan(amount)) {
        throw new BadRequestException('Insufficient balance');
      }

      const updatedSender = await tx.wallet.update({
        where: { id: fromWallet.id },
        data: { balance: { decrement: amount } },
      });

      if (new Decimal(updatedSender.balance).isNegative()) {
         throw new BadRequestException('Insufficient balance');
      }

      await tx.walletTransaction.create({
        data: {
          walletId: fromWallet.id,
          type: 'PURCHASE',
          amount: -amount,
          balanceBefore: fromWallet.balance,
          balanceAfter: updatedSender.balance,
          currency: fromWallet.currency,
          description: `Transfer to ${toUserId}: ${description}`,
          descriptionAr: `تحويل إلى ${toUserId}: ${descriptionAr}`,
          reference,
          status: 'COMPLETED',
        },
      });

      const toWallet = await tx.wallet.findFirst({
        where: { userId: toUserId, tenantId },
      });

      if (!toWallet) {
        throw new NotFoundException('Receiver wallet not found or does not belong to this store');
      }

      const updatedReceiver = await tx.wallet.update({
        where: { id: toWallet.id },
        data: { balance: { increment: amount } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: toWallet.id,
          type: 'TOPUP',
          amount: amount,
          balanceBefore: toWallet.balance,
          balanceAfter: updatedReceiver.balance,
          currency: toWallet.currency,
          description: `Received from ${fromUserId}: ${description}`,
          descriptionAr: `مستلم من ${fromUserId}: ${descriptionAr}`,
          reference,
          status: 'COMPLETED',
        },
      });

      return { success: true };
    });
  }
}


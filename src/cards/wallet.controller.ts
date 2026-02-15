import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';
import { Public } from '../auth/public.decorator';
import { AddBankAccountDto, CreateTopUpRequestDto } from './dto/wallet.dto';

@Controller('wallet')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  async getBalance(@Request() req: any) {
    try {
      const tenantId = req.tenantId;

      // Extract userId from token - could be from 'sub' field or 'id' field
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      
      if (!userId) {
        // SECURITY FIX: Removed sensitive data from error logs
        throw new BadRequestException('User ID is required');
      }
      
      // SECURITY FIX: Removed sensitive request data logging
      
      const userData = {
        email: req.user?.email || '',
        name: req.user?.name || `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || '',
        role: req.user?.role || 'CUSTOMER',
      };
      
      // Get or create wallet for this specific user
      // This will create a User record in core DB if it doesn't exist, using the customer ID
      const wallet = await this.walletService.getOrCreateWallet(tenantId, userId, userData);
      
      // SECURITY FIX: Removed wallet data logging
      
      // Ensure balance is properly returned as a number/string
      return {
        ...wallet,
        balance: wallet.balance ? String(wallet.balance) : '0',
      };
    } catch (error: any) {
      // SECURITY FIX: Removed error logging that could expose user data
      // Return empty wallet on error
      return {
        id: '',
        tenantId: req.tenantId || req.user?.tenantId || '',
        userId: req.user?.id || req.user?.userId || req.user?.sub || '',
        balance: '0',
        currency: 'SAR',
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  @Get('transactions')
  async getTransactions(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    
    // Resolve user ID
    const user = await this.walletService.getOrCreateWallet(
      req.tenantId || req.user?.tenantId || 'default',
      userId,
      {
        email: req.user?.email || '',
        name: req.user?.name || '',
        role: req.user?.role || 'CUSTOMER',
      }
    );
    
    return this.walletService.getTransactions(
      user.userId,
      parseInt(page),
      parseInt(limit),
    );
  }

  // Allow authenticated customers to see merchant banks for wallet top-up
  @Public()
  @Get('banks')
  async getBanks(@Request() req: any) {
    // Get tenantId from request context (set by TenantMiddleware from subdomain/domain)
    // Fallback to user's tenantId if the request tenantId is not set
    const tenantId = req.tenantId || req.user?.tenantId;
    
    this.logger.debug(`Fetching banks for tenantId: ${tenantId} (Detected from: ${req.tenantDetectedFrom || 'unknown'})`);

    // We only block 'system' tenant to prevent accidental exposure of system-level banks
    if (tenantId === 'system' || !tenantId) {
      if (!tenantId) this.logger.warn('No tenantId found for getBanks request');
      return [];
    }
    
    return this.walletService.getBanks(tenantId);
  }

  @Get('bank-accounts')
  async getBankAccounts(@Request() req: any) {
    try {
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      if (!userId) {
        throw new BadRequestException('User ID is required. Please ensure you are authenticated.');
      }
      
      // Resolve user ID to ensure we're using the one in the core database
      const user = await this.walletService.getOrCreateWallet(
        req.tenantId || req.user?.tenantId || 'default',
        userId,
        {
          email: req.user?.email || '',
          name: req.user?.name || '',
          role: req.user?.role || 'CUSTOMER',
        }
      );
      
      return await this.walletService.getUserBankAccounts(user.userId);
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to get bank accounts');
    }
  }

  @Post('bank-accounts')
  async addBankAccount(
    @Request() req: any,
    @Body() body: AddBankAccountDto,
  ) {
    try {
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      if (!userId) {
        throw new BadRequestException('User ID is required. Please ensure you are authenticated.');
      }
      
      // Get tenantId and user data for syncing user if needed
      const tenantId = req.tenantId || req.user?.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
      const userData = {
        email: req.user?.email || '',
        name: req.user?.name || `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || '',
        role: req.user?.role || 'CUSTOMER',
      };
      
      return await this.walletService.addBankAccount(userId, body, tenantId, userData);
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to add bank account');
    }
  }

  @Delete('bank-accounts/:id')
  async deleteBankAccount(@Request() req: any, @Param('id') id: string) {
    try {
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      if (!userId) {
        throw new BadRequestException('User ID is required. Please ensure you are authenticated.');
      }

      // Resolve user ID
      const user = await this.walletService.getOrCreateWallet(
        req.tenantId || req.user?.tenantId || 'default',
        userId,
        {
          email: req.user?.email || '',
          name: req.user?.name || '',
          role: req.user?.role || 'CUSTOMER',
        }
      );

      // Verify the bank account belongs to the user
      const bankAccounts = await this.walletService.getUserBankAccounts(user.userId);
      const account = bankAccounts.find(acc => acc.id === id);
      
      if (!account) {
        throw new BadRequestException('Bank account not found or you do not have permission to delete it');
      }

      // Delete the bank account
      await this.walletService.deleteBankAccount(id);
      
      return { success: true, message: 'Bank account deleted successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to delete bank account');
    }
  }

  @Post('topup')
  async createTopUpRequest(
    @Request() req: any,
    @Body() body: CreateTopUpRequestDto,
  ) {
    return this.walletService.createTopUpRequest(
      req.tenantId,
      req.user.id || req.user.userId,
      {
        ...body,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  @Get('topup-requests')
  async getTopUpRequests(
    @Request() req: any,
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
  ) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    
    // Resolve user ID
    const user = await this.walletService.getOrCreateWallet(
      req.tenantId || req.user?.tenantId || 'default',
      userId,
      {
        email: req.user?.email || '',
        name: req.user?.name || '',
        role: req.user?.role || 'CUSTOMER',
      }
    );
    
    return this.walletService.getTopUpRequests(user.userId, status);
  }

  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Get('admin/topups')
  async getAllTopUps(@Request() req: any) {
    const tenantId = req.user.tenantId || req.tenantId;
    // SECURITY: Explicit tenant validation to prevent cross-tenant data access
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException('Valid tenant context required for this operation');
    }
    return this.walletService.getAllTopUpRequests(tenantId);
  }

  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Get('admin/pending-topups')
  async getPendingTopUps(@Request() req: any) {
    const tenantId = req.user.tenantId || req.tenantId;
    // SECURITY: Explicit tenant validation to prevent cross-tenant data access
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException('Valid tenant context required for this operation');
    }
    return this.walletService.getPendingTopUpRequests(tenantId);
  }

  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('admin/topup/:id/approve')
  async approveTopUp(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.id || req.user.userId;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new BadRequestException('Authorization header is required');
    }
    const authToken = authHeader.substring(7);
    const tenantId = req.user.tenantId || req.tenantId;
    // SECURITY: Explicit tenant validation to prevent cross-tenant operations
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException('Valid tenant context required for this operation');
    }
    
    return this.walletService.approveTopUpRequest(id, userId, authToken, tenantId);
  }

  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('admin/topup/:id/reject')
  async rejectTopUp(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const userId = req.user.id || req.user.userId;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new BadRequestException('Authorization header is required');
    }
    const authToken = authHeader.substring(7);
    const tenantId = req.user.tenantId || req.tenantId;
    
    return this.walletService.rejectTopUpRequest(id, userId, body.reason, authToken, tenantId);
  }
}

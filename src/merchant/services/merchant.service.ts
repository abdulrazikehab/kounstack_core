import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateMerchantProfileDto, MerchantSettingsDto } from '../dto';
import { UserService } from '../../user/user.service';
import { WalletService } from '../../cards/wallet.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);

  constructor(
    private prisma: PrismaService,
    private userService: UserService,
    private walletService: WalletService,
  ) {}

  // Get or create merchant for user
  async getOrCreateMerchant(tenantId: string, userId: string, data?: { businessName?: string; businessNameAr?: string; email?: string; name?: string; role?: string }) {
    let merchant = await this.prisma.merchant.findUnique({
      where: { userId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!merchant) {
      // CRITICAL: Verify tenant exists before creating merchant (to avoid foreign key constraint)
      // Retry check up to 5 times with delays (handles potential transaction timing issues)
      let tenant = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
        });
        if (tenant) {
          this.logger.log(`Tenant ${tenantId} found on attempt ${attempt + 1}`);
          break;
        }
        if (attempt < 4) {
          // Wait before retry (increasing delay: 50ms, 100ms, 200ms, 300ms)
          const delay = 50 * Math.pow(2, attempt);
          this.logger.warn(`Tenant ${tenantId} not found on attempt ${attempt + 1}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!tenant) {
        this.logger.error(`Tenant ${tenantId} does not exist after 5 attempts. Cannot create merchant.`);
        // Check if tenant exists in auth database (for better error message)
        throw new NotFoundException(`Tenant ${tenantId} not found. Please ensure the tenant is created in the core database first.`);
      }

      // Ensure user exists in core database (sync from auth if needed)
      let user = await this.prisma.user.findUnique({ where: { id: userId } });
      
      if (!user) {
        // User doesn't exist in core database, sync from auth
        if (data?.email) {
          this.logger.log(`User ${userId} not found in core database, syncing from auth...`);
          user = await this.userService.ensureUserExists(userId, {
            email: data.email,
            name: data.name,
            role: data.role || 'SHOP_OWNER',
            tenantId: tenantId, // Safe to pass now since tenant exists
          });
        } else {
          throw new NotFoundException('User not found in core database. Please ensure user is synced from auth service.');
        }
      }

      if (!user) {
        this.logger.error(`Failed to ensure user exists for userId=${userId}, tenantId=${tenantId || 'no-tenant'}, email=${data?.email || 'no-email'}`);
        throw new Error(`Failed to ensure user exists. Please ensure user is synced from auth service.`);
      }

      merchant = await this.prisma.merchant.create({
        data: {
          tenantId,
          userId,
          businessName: data?.businessName || user?.name || 'My Business',
          businessNameAr: data?.businessNameAr,
          email: user?.email || data?.email,
          status: 'ACTIVE',
        },
        include: { user: { select: { id: true, email: true, name: true } } },
      });

      if (!merchant) {
         throw new Error('Failed to create merchant record');
      }

      this.logger.log(`Created merchant ${merchant.id} for user ${userId} in tenant ${tenantId}`);
    }

    return merchant;
  }

  // Get merchant by ID
  async getMerchant(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        user: { select: { id: true, email: true, name: true, avatar: true } },
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return merchant;
  }

  // Get merchant by user ID
  async getMerchantByUserId(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, email: true, name: true, avatar: true } },
      },
    });

    return merchant;
  }

  // Update merchant profile
  async updateProfile(merchantId: string, dto: UpdateMerchantProfileDto) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        businessName: dto.businessName,
        businessNameAr: dto.businessNameAr,
        phone: dto.phone,
        email: dto.email,
        timezone: dto.timezone,
        lowBalanceThreshold: dto.lowBalanceThreshold,
      },
      include: {
        user: { select: { id: true, email: true, name: true, avatar: true } },
      },
    });

    this.logger.log(`Updated merchant profile ${merchantId}`);
    return updated;
  }

  // Update merchant settings
  async updateSettings(merchantId: string, dto: MerchantSettingsDto) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const currentSettings = (merchant.settings as any) || {};
    const newSettings = {
      ...currentSettings,
      ...dto,
    };

    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { settings: newSettings },
    });

    return updated.settings;
  }

  // Get merchant settings
  async getSettings(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { settings: true },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return merchant.settings || {
      locale: 'ar',
      theme: 'system',
      notificationPreferences: {
        orderUpdates: true,
        priceAlerts: true,
        promotions: true,
        lowBalance: true,
      },
    };
  }

  // Check if user is merchant owner or employee
  async getMerchantContext(userId: string) {
    // Check if user is a merchant owner
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
      select: { id: true, tenantId: true, status: true },
    });

    if (merchant) {
      return {
        merchantId: merchant.id,
        tenantId: merchant.tenantId,
        userId: merchant.userId,
        isOwner: true,
        employeeId: null,
        status: merchant.status,
      };
    }

    // Check if user is an employee
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: {
        merchant: { select: { id: true, tenantId: true, status: true } },
      },
    });

    if (employee) {
      return {
        merchantId: employee.merchantId,
        tenantId: employee.merchant.tenantId,
        userId: employee.userId,
        isOwner: false,
        employeeId: employee.id,
        status: employee.merchant.status,
        permissions: employee.permissions,
      };
    }

    return null;
  }

  // Validate merchant access
  async validateMerchantAccess(userId: string, requiredPermission?: string, userData?: { email?: string; name?: string; role?: string; tenantId?: string; type?: string }) {
    let context = await this.getMerchantContext(userId);

    if (!context) {
      // If no merchant account found, check if user is in core database
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, tenantId: true },
      });

      // If user not found by ID, check by email (user might exist with different ID)
      if (!user && userData?.email) {
        user = await this.prisma.user.findUnique({
          where: { email: userData.email },
          select: { id: true, email: true, name: true, role: true, tenantId: true },
        });
        if (user) {
          // User found by email with different ID - check merchant with actual user ID
          this.logger.log(`User found by email ${userData.email} with ID ${user.id} (JWT has ${userId}), checking merchant...`);
          context = await this.getMerchantContext(user.id);
          if (context) {
            // Merchant exists for the actual user - use that
            return context;
          }
        }
      }

      // If user not in core database but we have userData (e.g. from JWT), use that
      // This is common for newly registered customers or employees who haven't been synced yet
      const effectiveTenantId = user?.tenantId || userData?.tenantId;
      const effectiveEmail = user?.email || userData?.email;
      const effectiveRole = user?.role || userData?.role;
      const effectiveName = user?.name || userData?.name;

      this.logger.log(`validateMerchantAccess: userId=${userId}, effectiveTenantId=${effectiveTenantId}, effectiveEmail=${effectiveEmail}, effectiveRole=${effectiveRole}`);

      if (effectiveTenantId && effectiveEmail && effectiveRole !== 'SUPER_ADMIN') {
        this.logger.log(`Auto-creating merchant and wallet for ${effectiveRole} ${userId} in tenant ${effectiveTenantId}`);
        
        try {
          // First, ensure user exists in core database with proper data
          let coreUser = await this.prisma.user.findUnique({ where: { id: userId } });
          if (!coreUser) {
            this.logger.log(`User ${userId} not in core DB, syncing from auth...`);
            try {
              coreUser = await this.userService.ensureUserExists(userId, {
                email: effectiveEmail,
                name: effectiveName || undefined,
                role: effectiveRole,
                tenantId: effectiveTenantId,
              });
              if (!coreUser) {
                throw new Error('ensureUserExists returned null');
              }
              // IMPORTANT: Use the actual user ID from the database (might be different if found by email)
              const actualUserId = coreUser.id;
              if (actualUserId !== userId) {
                this.logger.warn(`User ID mismatch: JWT has ${userId}, but DB user has ${actualUserId}. Using DB user ID.`);
              }
              this.logger.log(`✅ User ${actualUserId} synced to core database`);
            } catch (syncError: any) {
              this.logger.error(`Failed to sync user to core DB: ${syncError?.message || String(syncError)}`, syncError?.stack);
              throw new BadRequestException(
                `Failed to sync user account: ${syncError?.message || 'Unknown error'}. ` +
                `Please try logging out and logging back in, or contact support.`
              );
            }
          } else {
            // User exists, but ensure tenantId is set correctly
            if (coreUser.tenantId !== effectiveTenantId) {
              this.logger.log(`Updating user ${userId} tenantId from ${coreUser.tenantId} to ${effectiveTenantId}`);
              try {
                coreUser = await this.prisma.user.update({
                  where: { id: userId },
                  data: { tenantId: effectiveTenantId },
                });
              } catch (updateError: any) {
                this.logger.warn(`Could not update tenantId for user ${userId}: ${updateError?.message}`);
              }
            }
          }

          // Use the actual user ID from the database (might be different from JWT userId if user was found by email)
          const actualUserId = coreUser.id;

          // Create merchant using the actual user ID from database
          await this.getOrCreateMerchant(effectiveTenantId, actualUserId, {
            email: effectiveEmail,
            name: effectiveName || undefined,
            role: effectiveRole,
          });
          this.logger.log(`✅ Merchant created/retrieved for ${actualUserId}`);

          // Create wallet using the actual user ID from database
          await this.walletService.getOrCreateWallet(effectiveTenantId, actualUserId, {
            email: effectiveEmail,
            name: effectiveName || undefined,
            role: effectiveRole,
          });
          this.logger.log(`✅ Wallet created/retrieved for ${actualUserId}`);
          
          // Refresh context using the actual user ID from database
          context = await this.getMerchantContext(actualUserId);
        } catch (e: any) {
          this.logger.error(`Error in auto-creation: ${e?.message || String(e)}`, e?.stack);
          // Re-throw with more context
          if (e instanceof BadRequestException) {
            throw e; // Re-throw BadRequestException as-is
          }
          throw new BadRequestException(
            `Failed to create merchant account: ${e?.message || 'Unknown error'}. ` +
            `Please ensure you have created a store/market first via the setup page.`
          );
        }
      } else if (!effectiveTenantId) {
        // Check if user is a customer - customers don't need tenantId
        if (effectiveRole === 'CUSTOMER' || userData?.type === 'customer') {
          this.logger.log(`Customer ${userId} accessing merchant features - tenantId not required for customers`);
          // Return null context for customers - they use customerId instead
          return null;
        }
        
        // User doesn't have a tenant - they need to create a store first
        this.logger.warn(`User ${userId} does not have a tenant. They need to create a store first.`);
        throw new BadRequestException(
          'You need to create a store/market first before accessing merchant features. ' +
          'Please complete the store setup from the dashboard.'
        );
      } else if (!effectiveEmail) {
        // User email is missing
        this.logger.warn(`User ${userId} does not have an email in JWT token.`);
        throw new BadRequestException(
          'User email is missing. Please log out and log in again to refresh your session.'
        );
      }
    }

    if (!context) {
      throw new NotFoundException('No merchant account found');
    }

    if (context.status !== 'ACTIVE') {
      throw new BadRequestException('Merchant account is not active');
    }

    // Check permission for employees
    if (!context.isOwner && requiredPermission) {
      const permissions = context.permissions as any;
      if (!permissions || !permissions[requiredPermission]) {
        throw new BadRequestException(`Permission denied: ${requiredPermission}`);
      }
    }

    return context;
  }

  // Get merchant wallet balance
  async getWalletBalance(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { userId: true, defaultCurrency: true },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: merchant.userId },
    });

    return {
      balance: wallet?.balance || 0,
      currency: merchant.defaultCurrency,
    };
  }
}


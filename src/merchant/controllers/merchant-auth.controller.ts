import {
  Controller,
  Post,
  Body,
  Get,
  Request,
  UseGuards,
  Headers,
  Ip,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MerchantService } from '../services/merchant.service';
import { EmployeeService } from '../services/employee.service';
import { MerchantSessionService } from '../services/merchant-session.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { MerchantLoginDto, ChangePasswordDto } from '../dto';
import * as bcrypt from 'bcrypt';

@Controller('merchant/auth')
export class MerchantAuthController {
  constructor(
    private readonly merchantService: MerchantService,
    private readonly employeeService: EmployeeService,
    private readonly sessionService: MerchantSessionService,
    private readonly auditService: MerchantAuditService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() dto: MerchantLoginDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ) {
    // Try to find merchant or employee by identifier
    // This would need to be implemented based on your auth service setup
    // For now, this is a placeholder that shows the structure

    throw new Error('Login should be handled by app-auth service - use /api/auth/login');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  async getMe(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.getMerchantContext(userId);

    if (!context) {
      // Try to create merchant account for user
      // Pass user data to ensure user exists in core database
      const merchant = await this.merchantService.getOrCreateMerchant(
        req.tenantId,
        userId,
        {
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
        },
      );

      return {
        user: {
          id: userId,
          email: req.user.email,
          role: req.user.role,
        },
        merchant: {
          id: merchant.id,
          businessName: merchant.businessName,
          businessNameAr: merchant.businessNameAr,
          status: merchant.status,
          defaultCurrency: merchant.defaultCurrency,
          timezone: merchant.timezone,
        },
        isOwner: true,
        employeeId: null,
        permissions: null, // Owners have all permissions implicitly
        mustChangePassword: false,
      };
    }

    const merchant = await this.merchantService.getMerchant(context.merchantId);

    // Normalize permissions to include all fields
    let normalizedPermissions = null;
    if (context.isOwner) {
      // Owners have all permissions implicitly - return null or all true
      normalizedPermissions = null;
    } else if (context.permissions) {
      // Normalize employee permissions to include all fields
      const perms = context.permissions as any;
      normalizedPermissions = {
        ordersCreate: perms.ordersCreate ?? false,
        ordersRead: perms.ordersRead ?? false,
        ordersUpdate: perms.ordersUpdate ?? false,
        ordersDelete: perms.ordersDelete ?? false,
        reportsRead: perms.reportsRead ?? false,
        walletRead: perms.walletRead ?? false,
        walletRecharge: perms.walletRecharge ?? false,
        playersWrite: perms.playersWrite ?? false,
        playersRead: perms.playersRead ?? false,
        employeesManage: perms.employeesManage ?? false,
        employeesRead: perms.employeesRead ?? false,
        settingsWrite: perms.settingsWrite ?? false,
        settingsRead: perms.settingsRead ?? false,
        invoicesRead: perms.invoicesRead ?? false,
        productsRead: perms.productsRead ?? false,
        productsWrite: perms.productsWrite ?? false,
      };
    }

    return {
      user: {
        id: userId,
        email: req.user.email,
        role: req.user.role,
      },
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        businessNameAr: merchant.businessNameAr,
        status: merchant.status,
        defaultCurrency: merchant.defaultCurrency,
        timezone: merchant.timezone,
      },
      isOwner: context.isOwner,
      employeeId: context.employeeId,
      permissions: normalizedPermissions,
      mustChangePassword: false,
    };
  }

@Post('change-password')
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  async changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    if (!dto.currentPassword || !dto.newPassword) {
      throw new Error('Current and new passwords are required');
    }

    // In a real implementation with separate auth service, this would be an API call
    // For now, assuming we can access the user's records via Prisma through a service method we'll create
    // Or we'll need to inject PrismaService here.
    
    // Since we don't have direct PrismaService injected and UserService doesn't expose password ops:
    // We will throw an error if we can't do it securely, OR we assume this is handled by the Auth Service.
    // However, to fix the "Deceptive Logic", we must NOT return success if we didn't do anything.
    
    // FIXED: Return error explaining this must be done via Auth Service
    // or implement actual logic if possible.
    
    // Attempt to invoke the Auth Service (if available internally) or throw
    // For this fix, we will simulate the correct flow by failing since we can't verify the old password
    // without access to the password hash (which is likely in a different microservice's DB if separated).
    
    // If app-core shares the DB with app-auth (PrismaService connects to same DB), we can do:
    /*
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) throw new UnauthorizedException();
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Invalid current password');
    const hash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hash } });
    */

    // Since we can't implement it purely here without more context/access:
    // We will change the response to NOT claim success.
    
    throw new Error('Password change must be performed via the Authentication Service endpoint /api/auth/change-password');
  }
}


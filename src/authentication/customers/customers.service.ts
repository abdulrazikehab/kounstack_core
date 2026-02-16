// src/customers/customers.service.ts
import { Injectable, Logger, NotFoundException, ConflictException, UnauthorizedException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import * as bcrypt from 'bcryptjs';
import { validateEmailWithMx, validateEmailWithKickbox, generateRecoveryId } from '../../utils/email-validator';
import { checkIpReputation } from '../../utils/ip-checker';
import { EmailService } from '../../email/email.service';
import { HttpService } from '@nestjs/axios';
import { RateLimitingService } from '../../rate-limiting/rate-limiting.service';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
const { authenticator } = require('otplib');
import * as QRCode from 'qrcode';

export interface CreateCustomerDto {
  email: string;
  phone?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  metadata?: unknown;
}

export interface UpdateCustomerDto {
  phone?: string;
  firstName?: string;
  lastName?: string;
  metadata?: unknown;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private httpService: HttpService,
    private authService: AuthService,
    private rateLimitingService: RateLimitingService,
  ) {}


  /**
   * Generate 6-digit OTP code
   */
  private generateResetCode(): string {
    // SECURITY FIX: Use cryptographically secure random number generator (NOT Math.random())
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Customer signup for storefront users - sends OTP for verification
   */
  async customerSignup(tenantId: string, signupDto: { email: string; password: string; firstName?: string; lastName?: string; phone?: string }, ipAddress?: string) {
    this.logger.log(`Customer signup attempt for tenant: ${tenantId}, email: ${signupDto.email}, IP: ${ipAddress}`);

    // [TASK] Rate limiting for signup
    if (ipAddress) {
      const rateLimit = await this.rateLimitingService.getSignupRateLimiter(ipAddress);
      if (!rateLimit.allowed) {
        this.logger.warn(`🚩 Rate limit exceeded for customer signup: ${signupDto.email}, IP: ${ipAddress}, resets at: ${rateLimit.resetTime}`);
        throw new ForbiddenException(`Too many signup attempts. Please try again after ${Math.ceil((rateLimit.resetTime.getTime() - Date.now()) / (60 * 1000))} minutes.`);
      }
    }

    // Check IP for VPN/Proxy
    if (ipAddress) {
      const ipCheck = await checkIpReputation(ipAddress);
      if (ipCheck.isVpn || ipCheck.isProxy || ipCheck.isTor) {
        this.logger.warn(`ًں”´ Blocking customer signup - VPN/Proxy detected: ${signupDto.email}, IP: ${ipAddress}, ISP: ${ipCheck.isp}`);
        throw new ForbiddenException('VPN/Proxy usage is not allowed. Please disable your VPN and try again.');
      }
    }

    // Normalize email
    const normalizedEmail = signupDto.email.toLowerCase().trim();

    // Validate email - local check (fast) + Kickbox API check (only on signup)
    const emailValidation = await validateEmailWithKickbox(normalizedEmail);
    if (!emailValidation.isValid) {
      this.logger.warn(`Customer signup with invalid email: ${normalizedEmail} - ${emailValidation.reason}`);
      throw new BadRequestException(emailValidation.reason || 'Invalid email address');
    }

    // For customer signups, we need a valid tenant context
    // Try to find by ID first, then by subdomain, then create if needed
    let tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        subdomain: true,
        name: true,
        storeType: true,
        customerRegistrationRequestEnabled: true,
        isPrivateStore: true,
      },
    });
    
    // If not found by ID, try subdomain
    if (!tenant) {
      tenant = await this.prisma.tenant.findUnique({
        where: { subdomain: tenantId },
        select: {
          id: true,
          subdomain: true,
          name: true,
          storeType: true,
          customerRegistrationRequestEnabled: true,
          isPrivateStore: true,
        },
      });
    }
    
    // If still not found, create the tenant
    if (!tenant) {
      this.logger.log(`Tenant '${tenantId}' not found, creating for customer signup...`);
      try {
        const platformName = process.env.PLATFORM_NAME || 'Koun';
        tenant = await this.prisma.tenant.create({
          data: {
            id: tenantId === 'default' ? undefined : tenantId,
            name: tenantId === 'default' ? platformName : `Store-${tenantId}`,
            subdomain: tenantId,
            plan: 'STARTER',
            status: 'ACTIVE',
          },
        });
        this.logger.log(`âœ… Tenant '${tenantId}' created successfully for customer signup`);
      } catch (error: any) {
        // Handle unique constraint violations - tenant might exist with different ID
        if (error?.code === 'P2002') {
          this.logger.log(`Tenant constraint conflict, finding existing tenant...`);
          // Try to find by subdomain again in case of race condition
          const subdomain = tenantId === 'default' ? 'default' : `store-${tenantId.substring(0, 8)}`;
          tenant = await this.prisma.tenant.findUnique({
            where: { subdomain },
          });
        }
        if (!tenant) {
          this.logger.error(`Failed to create or find tenant '${tenantId}': ${error?.message}`);
          throw new NotFoundException(`Store not found. Please check the store URL.`);
        }
      }
    }
    
    this.logger.log(`âœ… Using tenant '${tenant.id}' (subdomain: ${tenant.subdomain}) for customer signup`);

    // CHECK PRIVATE STORE STATUS
    if ((tenant as any).isPrivateStore) {
      this.logger.warn(`ًں”´ Blocking public signup for private store: ${tenant.id}`);
      throw new ForbiddenException('This store is private. Registration is by invitation only.');
    }

    // Use the actual tenant ID from the found/created tenant
    const actualTenantId = tenant.id;

    // CHECK B2B STORE WITH REGISTRATION REQUESTS ENABLED
    if ((tenant as any).storeType === 'B2B' && (tenant as any).customerRegistrationRequestEnabled) {
      this.logger.log(`ًں”„ B2B store with registration requests enabled - creating request instead of direct signup`);
      
      try {
        // Call core API to create registration request
        const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3002';
        const requestData = {
          tenantId: actualTenantId,
          email: normalizedEmail,
          password: signupDto.password,
          fullName: `${signupDto.firstName || ''} ${signupDto.lastName || ''}`.trim() || normalizedEmail.split('@')[0],
          phone: signupDto.phone,
          // Additional B2B fields will be passed from frontend
          storeName: (signupDto as any).storeName,
          activity: (signupDto as any).activity,
          companyName: (signupDto as any).companyName,
          city: (signupDto as any).city,
          country: (signupDto as any).country,
        };

        const response = await firstValueFrom(
          this.httpService.post(`${coreApiUrl}/api/customer-registration-requests`, requestData)
        );

        this.logger.log(`âœ… Registration request created: ${response.data.id}`);
        
        return {
          success: true,
          requiresApproval: true,
          message: response.data.message || 'Your registration request has been submitted. You will receive an email once it is reviewed.',
          requestId: response.data.id,
        };
      } catch (error: any) {
        this.logger.error(`â‌Œ Failed to create registration request: ${error.message}`, error.response?.data);
        throw new BadRequestException(
          error.response?.data?.message || 'Failed to submit registration request. Please try again later.'
        );
      }
    }

    // Check if customer already exists - first check in this tenant, then across all tenants
    const existingCustomerInTenant = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId: actualTenantId,
          email: normalizedEmail,
        },
      },
      include: {
        employees: {
          where: {
            isActive: true,
          },
        },
      },
    });

    if (existingCustomerInTenant) {
      // SECURITY: If customer has active employees, they are a "custom customer" and cannot register
      if (existingCustomerInTenant.employees && existingCustomerInTenant.employees.length > 0) {
        this.logger.warn(`Registration blocked: Customer ${normalizedEmail} has active employees (custom customer)`);
        throw new ForbiddenException('This account is managed by your organization. Please contact your administrator to access your account.');
      }
      throw new ConflictException('Customer with this email already exists in this store');
    }

    // GLOBAL EMAIL CHECK: check if email exists in ANY tenant
    // This addresses the requirement "make the found email can't make signup or send otp"
    const globalExistingCustomer = await this.prisma.customer.findFirst({
        where: { email: normalizedEmail }
    });
    
    if (globalExistingCustomer) {
        this.logger.warn(`Global registration blocked: Customer ${normalizedEmail} already exists in another tenant (${globalExistingCustomer.tenantId})`);
        const message = 'ظ‡ط°ط§ ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ظ…ط³ط¬ظ„ ظ…ط³ط¨ظ‚ط§ظ‹ ظپظٹ ط§ظ„ظ†ط¸ط§ظ…. ظٹط±ط¬ظ‰ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط£ظˆ ط§ط³طھط®ط¯ط§ظ… ط¨ط±ظٹط¯ ط¢ط®ط±.';
        throw new ConflictException(message);
    }

    // NOTE: We only check if they exist IN THIS TENANT. 
    // Users ARE allowed to register with the same email in multiple different stores.
    // This allows each store to have its own customer data and settings for that user.

    // Check for existing pending signup
    const existingPending = await this.prisma.passwordReset.findFirst({
      where: {
        email: normalizedEmail,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
        code: {
          startsWith: 'CUSTOMER_SIGNUP_',
        },
      },
    });

    if (existingPending) {
      // Allow resending OTP by deleting the old pending signup and creating a new one
      this.logger.log(`Found existing pending customer signup for ${normalizedEmail}, cleaning up and allowing new signup...`);
      await this.prisma.passwordReset.delete({
        where: { id: existingPending.id },
      });
    }

    // Generate OTP code (mark with CUSTOMER_SIGNUP_ prefix)
    const verificationCode = this.generateResetCode();
    const signupCode = `CUSTOMER_SIGNUP_${verificationCode}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Hash password before storing
    const hashedPassword = await bcrypt.hash(signupDto.password, 12);

    // Store signup data temporarily in passwordReset table
    const signupData = {
      email: normalizedEmail,
      password: hashedPassword,
      firstName: signupDto.firstName,
      lastName: signupDto.lastName,
      phone: signupDto.phone,
      tenantId: actualTenantId,
    };

    // Store in passwordReset table with signup data
    try {
      await this.prisma.passwordReset.create({
        data: {
          email: normalizedEmail,
          code: signupCode,
          expiresAt,
          signupData: JSON.stringify(signupData),
        },
      });
    } catch (dbError) {
      this.logger.warn(`Failed to store signupData in DB (schema might be outdated), falling back to basic create: ${dbError}`);
      // Fallback: Try creating without signupData
      await this.prisma.passwordReset.create({
        data: {
          email: normalizedEmail,
          code: signupCode,
          expiresAt,
        },
      });
    }

    // Send verification email with the actual OTP
    let emailSent = false;
    let smsSent = false;
    let emailResult: any = null;
    let emailErrorObj: any = null;
    
    try {
      this.logger.log(`ًں“§ ========================================`);
      this.logger.log(`ًں“§ SENDING CUSTOMER SIGNUP OTP`);
      this.logger.log(`ًں“§ To: ${normalizedEmail}`);
      if (signupDto.phone) this.logger.log(`ًں“± Phone: ${signupDto.phone}`);
      this.logger.log(`ًں”¢ Code: ${verificationCode}`);
      this.logger.log(`ًں“§ ========================================`);
      
      // 1. Send Email
      try {
        emailResult = await this.emailService.sendVerificationEmail(normalizedEmail, verificationCode, actualTenantId);
        emailSent = true;
      } catch (err: any) {
        emailErrorObj = err;
        this.logger.error(`â‌Œ Email sending failed: ${err.message}`);
      }

      // 2. Send SMS OTP if phone is provided
      if (signupDto.phone) {
        try {
          smsSent = await this.sendSMSOTP(signupDto.phone, verificationCode, actualTenantId);
          if (smsSent) this.logger.log(`âœ… SMS OTP sent successfully to ${signupDto.phone}`);
        } catch (smsError: any) {
          this.logger.error(`â‌Œ SMS OTP sending failed: ${smsError.message}`);
        }
      }
    } catch (error) {
      this.logger.error('â‌Œ Failed to send verification notifications:', error);
    }

    this.logger.log(`ًں“§ OTP sent for customer signup: ${normalizedEmail} (account will be created AFTER OTP verification)`);

    // IMPORTANT: NO CUSTOMER IS CREATED YET!
    // Customer account will ONLY be created in verifyCustomerSignupCode() after successful OTP verification
    const response: any = {
      email: normalizedEmail,
      emailVerified: false,
      verificationCodeSent: emailSent || smsSent,
      smsSent: smsSent,
      verificationCode: verificationCode, // Always return code for development/testing
    };

    if (emailSent && emailResult) {
      if (emailResult.isTestEmail || emailResult.previewUrl) {
        response.emailPreviewUrl = emailResult.previewUrl;
        response.isTestEmail = true;
        response.emailWarning = 'Using test email service. Check preview URL or use code below.';
      }
    }
    
    if (!emailSent && emailErrorObj) {
      response.emailError = emailErrorObj instanceof Error ? emailErrorObj.message : 'Email sending failed';
      response.emailWarning = 'Email sending failed, but you can use the code above to verify.';
    }
    
    this.logger.log(`âœ… Customer signup completed for: ${normalizedEmail} - NO CUSTOMER CREATED (waiting for OTP verification)`);
    this.logger.log(`ًں“‹ OTP Code: ${verificationCode} (customer must verify before account creation)`);
    
    return response;
  }

  /**
   * Verify customer signup OTP code and create customer account
   */
  async verifyCustomerSignupCode(email: string, code: string, expectedTenantId?: string): Promise<{ valid: boolean; message: string; token?: string; accessToken?: string; refreshToken?: string; customer?: any; recoveryId?: string }> {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find the signup verification code (with CUSTOMER_SIGNUP_ prefix)
    const signupCode = `CUSTOMER_SIGNUP_${code}`;
    
    this.logger.log(`ًں”چ Verifying customer signup code for ${normalizedEmail}: ${signupCode}`);
    
    const resetRecord = await this.prisma.passwordReset.findFirst({
      where: {
        email: normalizedEmail,
        code: signupCode,
        used: false,
        expiresAt: {
          gt: new Date(), // Not expired
        },
      },
      select: {
        id: true,
        email: true,
        code: true,
        expiresAt: true,
        used: true,
        signupData: true,
      },
    });

    if (!resetRecord) {
      return {
        valid: false,
        message: 'Invalid or expired verification code',
      };
    }

    // Get signup data from database
    let signupData: any = null;
    if (resetRecord.signupData) {
      try {
        signupData = JSON.parse(resetRecord.signupData);
        this.logger.log(`âœ… Retrieved customer signup data from database for: ${normalizedEmail}`);
      } catch (parseError) {
        this.logger.error(`â‌Œ Failed to parse signup data from database for ${normalizedEmail}: ${parseError}`);
        return {
          valid: false,
          message: 'Signup session expired. Please sign up again.',
        };
      }
    }

    if (!signupData) {
      this.logger.error(`â‌Œ Signup data not found for: ${normalizedEmail}_${code}`);
      return {
        valid: false,
        message: 'Signup session expired. Please sign up again.',
      };
    }

    // STRICT: Ensure the verification code is for the expected store
    if (expectedTenantId && signupData.tenantId !== expectedTenantId) {
      // If expectedTenantId is a subdomain, try to match it
      let tenantMatch = false;
      try {
        const targetTenant = await this.prisma.tenant.findFirst({
           where: {
             OR: [
               { id: expectedTenantId },
               { subdomain: expectedTenantId }
             ]
           }
        });
        if (targetTenant && targetTenant.id === signupData.tenantId) {
          tenantMatch = true;
        }
      } catch (e) {
        this.logger.error(`Error resolving expectedTenantId ${expectedTenantId}: ${e}`);
      }
      
      if (!tenantMatch) {
        this.logger.warn(`ًںڑ« Cross-tenant verification attempt blocked: email=${normalizedEmail}, codeTenantId=${signupData.tenantId}, expectedTenantId=${expectedTenantId}`);
        return {
          valid: false,
          message: 'This verification code is for a different store. Please make sure you are on the correct store website.',
        };
      }
    }

    // Re-check if customer already exists (race condition protection)
    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        email: normalizedEmail,
        tenantId: signupData.tenantId,
      },
    });

    if (existingCustomer) {
      // Mark the reset record as used
      await this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { used: true },
      });
      return {
        valid: false,
        message: 'Customer with this email already exists in this store',
      };
    }

    // Generate recovery ID
    const recoveryId = generateRecoveryId();

    // Create customer with password in metadata
    const customer = await this.prisma.customer.create({
      data: {
        tenantId: signupData.tenantId,
        email: normalizedEmail,
        phone: signupData.phone,
        firstName: signupData.firstName,
        lastName: signupData.lastName,
        recoveryId,
        metadata: JSON.stringify({ password: signupData.password }),
      },
    });

    // Mark the reset record as used
    await this.prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    // Generate JWT tokens
    const tokens = await this.authService.generateTokens(customer, true);

    this.logger.log(`âœ… Customer created after OTP verification: ${customer.id}`);

    // Notify app-core about new customer
    try {
      const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3002';
      await firstValueFrom(
        this.httpService.post(`${coreApiUrl}/api/notifications/send`, {
          tenantId: signupData.tenantId,
          type: 'CUSTOMER',
          titleEn: 'New Customer Registered',
          titleAr: 'طھط³ط¬ظٹظ„ ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯',
          bodyEn: `A new customer (${normalizedEmail}) has registered in your store.`,
          bodyAr: `ظ‚ط§ظ… ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯ (${normalizedEmail}) ط¨ط§ظ„طھط³ط¬ظٹظ„ ظپظٹ ظ…طھط¬ط±ظƒ.`,
          data: { customerId: customer.id, email: normalizedEmail }
        })
      );
      this.logger.log(`âœ… Notification sent to app-core for new customer: ${customer.id}`);
    } catch (error: any) {
      this.logger.error(`â‌Œ Failed to send notification to app-core: ${error.message}`);
    }

    // Fetch tenant subdomain for redirection
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: customer.tenantId },
      select: { subdomain: true, id: true, name: true }
    });

    this.logger.log(`ًں“§ Customer OTP verification - Tenant lookup: tenantId=${customer.tenantId}, subdomain=${tenant?.subdomain || 'NOT FOUND'}, name=${tenant?.name || 'N/A'}`);
    
    if (!tenant || !tenant.subdomain) {
      this.logger.error(`â‌Œ CRITICAL: Tenant not found or missing subdomain for tenantId=${customer.tenantId}. Customer will not be redirected correctly.`);
    } else if (expectedTenantId && expectedTenantId !== 'default') {
      // Log if there's a mismatch between expected and actual tenant
      const expectedSubdomain = expectedTenantId.includes('.') ? expectedTenantId.split('.')[0] : expectedTenantId;
      if (tenant.subdomain !== expectedSubdomain) {
        this.logger.warn(`âڑ ï¸ڈ Tenant subdomain mismatch: Expected=${expectedSubdomain}, Actual=${tenant.subdomain} for tenantId=${customer.tenantId}`);
      }
    }

    return {
      valid: true,
      message: 'Email verified successfully. Account created.',
      token: tokens.accessToken, // Keep for backward compatibility
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        tenant: tenant ? { subdomain: tenant.subdomain } : undefined
      },
      recoveryId,
    };
  }

  /**
   * Resend customer signup verification code
   */
  async resendCustomerVerificationCode(email: string, requestedTenantId?: string): Promise<{ success: boolean; message: string; verificationCode?: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find all pending signups for this email
    const pendingSignups = await this.prisma.passwordReset.findMany({
      where: {
        email: normalizedEmail,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
        code: {
          startsWith: 'CUSTOMER_SIGNUP_',
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pendingSignups || pendingSignups.length === 0) {
      return {
        success: false,
        message: 'No pending signup found. Please sign up again.',
      };
    }

    // Try to find the specific one for the requested tenantId
    let targetSignup = pendingSignups[0]; // Default to most recent
    
    if (requestedTenantId) {
      const tenantMatch = pendingSignups.find((p: any) => {
        if (!p.signupData) return false;
        try {
          const data = typeof p.signupData === 'string' ? JSON.parse(p.signupData) : p.signupData;
          return data.tenantId === requestedTenantId;
        } catch {
          return false;
        }
      });
      
      if (tenantMatch) {
        targetSignup = tenantMatch;
      } else {
        // If we requested a specific tenant but didn't find a match, don't just resend a random one
        return {
          success: false,
          message: 'No pending signup found for this store. Please sign up again.',
        };
      }
    }

    // Extract the code from the stored code (remove CUSTOMER_SIGNUP_ prefix)
    const storedCode = targetSignup.code.replace('CUSTOMER_SIGNUP_', '');
    
    // Extract tenantId and phone from signupData if available
    let tenantId: string | undefined;
    let phone: string | undefined;
    if (targetSignup.signupData) {
      try {
        const data = typeof targetSignup.signupData === 'string' 
          ? JSON.parse(targetSignup.signupData) 
          : targetSignup.signupData;
        tenantId = data.tenantId;
        phone = data.phone;
        this.logger.log(`âœ… Extracted data from existing signup: tenantId=${tenantId}, phone=${phone}`);
      } catch (e) {
        this.logger.warn(`Failed to parse signupData for extraction: ${e}`);
      }
    }

    // GLOBAL EMAIL CHECK (Defensive): check if email exists in ANY tenant
    const globalExistingCustomer = await this.prisma.customer.findFirst({
        where: { email: normalizedEmail }
    });

    if (globalExistingCustomer) {
        this.logger.warn(`Resend blocked: Customer ${normalizedEmail} already exists`);
        return {
            success: false,
            message: 'This email is already registered. Please login.',
        };
    }
    
    // Send notifications
    let emailSent = false;
    let smsSent = false;
    
    try {
      // 1. Send Email
      try {
        await this.emailService.sendVerificationEmail(normalizedEmail, storedCode, tenantId);
        emailSent = true;
        this.logger.log(`âœ… Resent verification email to ${normalizedEmail}`);
      } catch (error: any) {
        this.logger.error(`â‌Œ Failed to resend verification email: ${error.message}`);
      }

      // 2. Send SMS if phone is available
      if (phone) {
        try {
          smsSent = await this.sendSMSOTP(phone, storedCode, tenantId || 'default');
          if (smsSent) this.logger.log(`âœ… Resent SMS OTP to ${phone}`);
        } catch (smsError: any) {
          this.logger.error(`â‌Œ Failed to resend SMS OTP: ${smsError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`â‌Œ Notifications resend failed: ${error}`);
    }

    const overallSuccess = emailSent || smsSent;

    if (!overallSuccess && process.env.NODE_ENV !== 'development') {
      return {
        success: false,
        message: 'Failed to resend verification code. Please try again later.',
      };
    }

    return {
      success: true,
      message: 'Verification code resent successfully',
      verificationCode: process.env.NODE_ENV === 'development' ? storedCode : undefined,
    };
  }

  /**
   * Customer login for storefront users
   */
  async customerLogin(tenantId: string, loginDto: { email: string; password: string }) {
    this.logger.log(`Customer login attempt for tenant: ${tenantId}, email: ${loginDto.email}`);

    try {
      // STRICT: The controller should have already resolved the tenant
      // If we get 'default' here, something went wrong
      let requestedTenantId = tenantId;
      if (tenantId === 'default' || !tenantId) {
        this.logger.error(`â‌Œ customerLogin called with invalid tenantId: "${tenantId}"`);
        throw new UnauthorizedException(
          'Unable to determine which store you are trying to access. Please ensure you are on the correct store URL.'
        );
      }

      // Normalize email
      const normalizedEmail = loginDto.email.toLowerCase().trim();

      // 0. First check if this is a CustomerEmployee trying to login
      // Customer employees are separate from shop owner staff
      let customerEmployee = null;
      try {
        customerEmployee = await this.prisma.customerEmployee.findFirst({
          where: {
            email: normalizedEmail,
            isActive: true,
            customer: {
              tenantId: requestedTenantId,
            },
          },
          include: {
            customer: {
              include: {
                tenant: {
                  select: { id: true, subdomain: true }
                }
              }
            },
          },
        });
      } catch (error: any) {
        // If CustomerEmployee table doesn't exist, log and continue
        const errorMessage = error?.message || String(error);
        if (errorMessage.includes('does not exist') || 
            errorMessage.includes('Unknown table') ||
            errorMessage.includes('relation') && errorMessage.includes('does not exist') ||
            errorMessage.includes('Table') && errorMessage.includes('doesn\'t exist')) {
          this.logger.warn('CustomerEmployee table does not exist, skipping employee check. Run migration: npx prisma migrate dev');
          customerEmployee = null; // Explicitly set to null
        } else {
          this.logger.error('Error checking for customer employee:', {
            message: errorMessage,
            code: error?.code,
            meta: error?.meta,
          });
          // Don't throw - continue with regular customer login
          customerEmployee = null;
        }
      }

    if (customerEmployee) {
      // Customer employee found - verify password
      const isPasswordValid = await bcrypt.compare(loginDto.password, customerEmployee.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Customer employee should login as the customer they belong to
      // They use the customer's account but with employee permissions
      const customer = customerEmployee.customer;

      if (!customer) {
        this.logger.error(`Customer employee ${customerEmployee.id} has no associated customer`);
        throw new UnauthorizedException('Invalid account configuration');
      }

      // Generate JWT token for customer login (employee uses customer's account)
      const token = this.jwtService.sign({
        sub: customerEmployee.id,
        email: customerEmployee.email,
        tenantId: customer.tenantId,
        type: 'customer_employee',
        employeeId: customerEmployee.id, // Include employee ID for permission checks
        customerId: customer.id, // Include customer ID for reference
      });

      this.logger.log(`âœ… Customer employee logged in: ${customerEmployee.id} (Employee: ${customerEmployee.email}, Employer: ${customer.email})`);

      // Get employee permissions
      const employeeWithPermissions = await this.prisma.customerEmployee.findUnique({
        where: { id: customerEmployee.id },
        include: { permissions: true },
      });

      const permissions = employeeWithPermissions?.permissions?.map((p: { permission: string }) => p.permission) || [];

      // Return employee-specific response
      return { 
        token, 
        customer: { 
          id: customerEmployee.id, 
          email: customerEmployee.email, 
          firstName: customerEmployee.name?.split(' ')[0] || '', 
          lastName: customerEmployee.name?.split(' ').slice(1).join(' ') || '', 
          phone: customerEmployee.phone,
          tenantId: customer.tenantId,
          tenantSubdomain: (customer as any).tenant?.subdomain
        },
        isEmployee: true, 
        employerEmail: customer.email, 
        permissions,
        mustChangePassword: customerEmployee.mustChangePassword || false // Include flag for first login
      };
    }

    // 1. Check if this is a STAFF user (shop owner staff) trying to login as customer
    const staffUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: 'STAFF',
        tenantId: requestedTenantId,
      },
    });

    if (staffUser) {
      // STAFF user found - verify password using User table
      const isPasswordValid = await bcrypt.compare(loginDto.password, staffUser.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Use staff user's tenantId or requested tenantId
      const targetTenantId = staffUser.tenantId || requestedTenantId;

      // Try to find or create customer record for this staff in the target tenant
      let customer = await this.prisma.customer.findUnique({
        where: {
          tenantId_email: {
            tenantId: targetTenantId,
            email: normalizedEmail,
          },
        },
        include: {
          tenant: {
            select: { id: true, subdomain: true }
          }
        }
      });

      if (!customer) {
        // Create customer record for staff user
        const nameParts = (staffUser.name || '').split(' ');
        customer = await this.prisma.customer.create({
          data: {
            tenantId: targetTenantId,
            email: normalizedEmail,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            recoveryId: generateRecoveryId(),
            metadata: JSON.stringify({ password: staffUser.password, isStaff: true, staffUserId: staffUser.id }),
          },
        });
      }

      // Generate JWT token for customer login
      const token = this.jwtService.sign({
        sub: customer.id,
        email: customer.email,
        tenantId: customer.tenantId,
        type: 'customer',
      });

      this.logger.log(`âœ… STAFF user logged in as customer: ${customer.id} (Tenant: ${customer.tenantId})`);

      return {
        token,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          tenantId: customer.tenantId,
          tenantSubdomain: (customer as any).tenant?.subdomain
        },
      };
    }

    // 1. Find customer in the requested tenant first
    let customer = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId: requestedTenantId,
          email: normalizedEmail,
        },
      },
      include: {
        tenant: {
          select: { id: true, subdomain: true }
        }
      }
    });

    // 2. Strict isolation: Customer must exist in the requested tenant
    if (!customer) {
      this.logger.warn(`Customer not found in requested tenant: ${requestedTenantId}`);
      throw new UnauthorizedException('Invalid email or password. Please check your credentials or sign up if you don\'t have an account in this store.');
    }

    if (!customer) {
      this.logger.warn(`Customer not found: ${normalizedEmail} in any tenant`);
      throw new UnauthorizedException('Invalid email or password. Please check your credentials or sign up if you don\'t have an account.');
    }

    // 3. Final password verification (if we didn't already do it above)
    let metadata: { password?: string } = {};
    try {
      metadata = typeof customer.metadata === 'string' ? JSON.parse(customer.metadata) : customer.metadata as { password?: string };
    } catch (error) {
      this.logger.error('Failed to parse customer metadata:', error);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!metadata.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, metadata.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 4. Check if 2FA is enabled
    if (customer.twoFactorEnabled) {
      return {
        requiresTwoFactor: true,
        customerId: customer.id,
      };
    }

    // Generate JWT tokens
    const tokens = await this.authService.generateTokens(customer, true);

    this.logger.log(`âœ… Customer logged in: ${customer.id} (Tenant: ${customer.tenantId})`);

    return {
      token: tokens.accessToken, // Keep for backward compatibility
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        tenantId: customer.tenantId,
        tenantSubdomain: (customer as any).tenant?.subdomain
      },
    };
    } catch (error: any) {
      this.logger.error('Error in customerLogin:', {
        error: error.message,
        stack: error.stack,
        tenantId,
        email: loginDto.email,
      });
      
      // Re-throw known exceptions
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      
      // For unknown errors, throw a BadRequestException (NestJS will handle it properly)
      this.logger.error('Unexpected error in customerLogin:', {
        error: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
      });
      throw new BadRequestException(`Login failed: ${error.message || 'Unknown error occurred. Please try again or contact support.'}`);
    }
  }

  async createCustomer(tenantId: string, createCustomerDto: CreateCustomerDto, requestSubdomain?: string, requestPort?: string) {
    this.logger.log(`Creating customer for tenant: ${tenantId}, email: ${createCustomerDto.email}`);

    // Check if customer already exists
    const existingCustomer = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: createCustomerDto.email,
        },
      },
    });

    if (existingCustomer) {
      throw new ConflictException('Customer with this email already exists');
    }

    // Check for Private Store and get tenant subdomain
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const isPrivateStore = (tenant as any)?.isPrivateStore || false;
    
    // Priority: 1. Request subdomain (from headers/hostname), 2. Tenant subdomain from DB
    // If requestSubdomain is not provided, use tenant's subdomain from database
    const subdomainToUse = requestSubdomain || (tenant?.subdomain);

    // Generate invite token for all customers created via dashboard
    let inviteToken = crypto.randomBytes(32).toString('hex');
    let inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Handle password hashing if provided
    let metadata: any = createCustomerDto.metadata || {};
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
    }
    
    if (createCustomerDto.password) {
      const hashedPassword = await bcrypt.hash(createCustomerDto.password, 12);
      metadata.password = hashedPassword;
      // If password provided, invite token is optional/secondary, but we still generate it
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        email: createCustomerDto.email,
        phone: createCustomerDto.phone,
        firstName: createCustomerDto.firstName,
        lastName: createCustomerDto.lastName,
        recoveryId: generateRecoveryId(),
        // @ts-ignore - Schema might not be updated yet in types
        inviteToken,
        inviteExpiresAt,
        metadata: JSON.stringify(metadata),
      },
    });

    this.logger.log(`âœ… Customer created: ${customer.id}`);
    
    // Send invitation email with link
    if (inviteToken) {
      try {
        // Build invite URL using the same logic as email service
        let inviteUrl = `invite?token=${inviteToken}`;
        
        // subdomainToUse is already set above
        
        if (subdomainToUse) {
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
          
          if (process.env.NODE_ENV === 'development' && (frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1'))) {
            // Priority: 1. Request port, 2. FRONTEND_URL port, 3. Default 8080
            let port = requestPort || '8080';
            if (!requestPort) {
              try {
                const urlObj = new URL(frontendUrl);
                if (urlObj.port) {
                  port = urlObj.port;
                } else if (urlObj.protocol === 'https:') {
                  port = '443';
                } else {
                  port = '8080'; // Default to 8080 for development
                }
              } catch (e) {
                // If URL parsing fails, use default port 8080
                port = '8080';
              }
            }
            
            const portPart = port && port !== '80' && port !== '443' ? `:${port}` : '';
            inviteUrl = `http://${subdomainToUse}.localhost${portPart}/${inviteUrl}`;
          } else {
            // Production: use subdomain.kawn.com format
            const baseDomain = frontendUrl.includes('http') 
              ? new URL(frontendUrl).hostname.replace('app.', '').replace('www.', '')
              : frontendUrl.replace('https://', '').replace('http://', '').replace('app.', '').replace('www.', '');
            inviteUrl = `https://${subdomainToUse}.${baseDomain}/${inviteUrl}`;
          }
        } else {
          // Fallback: use FRONTEND_URL directly
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
          inviteUrl = frontendUrl.endsWith('/') 
            ? `${frontendUrl}${inviteUrl}`
            : `${frontendUrl}/${inviteUrl}`;
        }
        
        this.logger.log(`ًں“§ Building invite URL: ${inviteUrl}`);
        this.logger.log(`ًں“§ Subdomain resolution: requestSubdomain=${requestSubdomain || 'none'}, tenant.subdomain=${tenant?.subdomain || 'none'}, using=${subdomainToUse || 'none'}`);
        this.logger.log(`ًں“§ Port resolution: requestPort=${requestPort || 'none'}, FRONTEND_URL=${process.env.FRONTEND_URL || 'none'}, using=${requestPort || '8080'}`);
        this.logger.log(`ًں“§ Full invite URL: ${inviteUrl}`);
        
        // Send invitation email - pass the full URL
        await this.emailService.sendInvitationEmail(
          customer.email,
          inviteUrl, // Already a full URL
          tenantId
        );
        
        this.logger.log(`âœ… Invitation email sent to ${customer.email} with URL: ${inviteUrl}`);
      } catch (emailError: any) {
        // Log error but don't fail customer creation
        this.logger.error(`â‌Œ Failed to send invitation email: ${emailError.message}`);
      }
    }
    
    // Always return invite URL - use the same URL that was sent in email
    if (inviteToken) {
       // Build the same URL that was sent in email
       let inviteUrl = `invite?token=${inviteToken}`;
       
       // Use the same subdomain logic as above
       const subdomainToUse = requestSubdomain || (tenant && tenant.subdomain);
       
       if (subdomainToUse) {
         const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
         
          if (process.env.NODE_ENV === 'development' && (frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1'))) {
           // Priority: 1. Request port, 2. FRONTEND_URL port, 3. Default 8080
           let port = requestPort || '8080';
           if (!requestPort) {
             try {
               const urlObj = new URL(frontendUrl);
               if (urlObj.port) {
                 port = urlObj.port;
               } else {
                 port = '8080';
               }
             } catch (e) {
               port = '8080';
             }
           }
           
           const portPart = port && port !== '80' && port !== '443' ? `:${port}` : '';
           inviteUrl = `http://${subdomainToUse}.localhost${portPart}/${inviteUrl}`;
         } else {
           const baseDomain = frontendUrl.includes('http') 
             ? new URL(frontendUrl).hostname.replace('app.', '').replace('www.', '')
             : frontendUrl.replace('https://', '').replace('http://', '').replace('app.', '').replace('www.', '');
           inviteUrl = `https://${subdomainToUse}.${baseDomain}/${inviteUrl}`;
         }
       } else {
         const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
         inviteUrl = frontendUrl.endsWith('/') 
           ? `${frontendUrl}${inviteUrl}`
           : `${frontendUrl}/${inviteUrl}`;
       }
       
       const invitation = {
         ...customer,
         inviteToken,
         inviteUrl: inviteUrl // Return full URL
       };
       return invitation;
    }

    return customer;
  }

  /**
   * Send OTP for an invited customer
   */
  async sendInviteOtp(token: string) {
    // specific implementation for invite flow
    // 1. Find customer OR employee by invite token
    let customer: any = await this.prisma.customer.findFirst({
        where: { 
            // @ts-ignore
            inviteToken: token,
            inviteExpiresAt: { gt: new Date() }
        }
    });

    let isEmployee = false;
    let tenantId = 'default';

    if (!customer) {
        // Check Employee
        const employee = await this.prisma.customerEmployee.findFirst({
            where: {
                // @ts-ignore
                inviteToken: token,
                inviteExpiresAt: { gt: new Date() }
            },
            include: { customer: true }
        });
        
        if (employee) {
            customer = employee;
            isEmployee = true;
            tenantId = employee.customer.tenantId; // Use employer's tenant
        }
    } else {
        tenantId = customer.tenantId;
    }

    this.logger.log(`ًں“§ Sending Invite OTP for ${customer.email} (Tenant: ${tenantId})`);

    if (!customer) {
        throw new NotFoundException('Invalid or expired invitation link');
    }

    // 2. Generate OTP
    const otp = this.generateResetCode();
    const verificationCode = `CUSTOMER_INVITE_${otp}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // 3. Save OTP
    // For employee, we still save OTP in PasswordReset.
    // userId field in PasswordReset relates to User model. 
    // We can use the 'email' field to associate.
    await this.prisma.passwordReset.create({
        data: {
            email: customer.email,
            code: verificationCode,
            expiresAt,
            // userId: customer.id // We can't link to User table if they aren't in it yet, or different ID space.
            // Just rely on email + code.
        }
    });

    // 4. Send Email
    try {
        await this.emailService.sendVerificationEmail(customer.email, otp, tenantId);
        return { success: true, message: 'OTP sent to your email', email: customer.email, developerCode: process.env.NODE_ENV === 'development' ? otp : undefined };
    } catch (e) {
        this.logger.error(`Failed to send invite OTP: ${e}`);
        if (process.env.NODE_ENV === 'development') {
            return { success: true, message: 'OTP sent (dev)', email: customer.email, developerCode: otp };
        }
        throw new BadRequestException('Failed to send verification email');
    }
  }

  /**
   * Verify Invite OTP and Login
   */
  async verifyInviteOtp(token: string, code: string, password?: string) {
     // 1. Find customer by invite token
    let customer: any = await this.prisma.customer.findFirst({
        where: { 
            // @ts-ignore
            inviteToken: token 
        }
    });

    let isEmployee = false;
    let employeeData = null;

    if (!customer) {
        // Check Employee
        const employee = await this.prisma.customerEmployee.findFirst({
            where: {
                // @ts-ignore
                inviteToken: token
            },
            include: { customer: true }
        });

        if (employee) {
            customer = employee;
            isEmployee = true;
            employeeData = employee;
        }
    }

    if (!customer) {
        throw new NotFoundException('Invalid invitation');
    }

    // 2. Verify OTP
    const verificationCode = `CUSTOMER_INVITE_${code}`;
    const resetRecord = await this.prisma.passwordReset.findFirst({
        where: {
            email: customer.email,
            code: verificationCode,
            used: false,
            expiresAt: { gt: new Date() }
        }
    });

    if (!resetRecord) {
        throw new BadRequestException('Invalid or expired OTP');
    }

    // 3. Mark OTP used
    await this.prisma.passwordReset.update({ where: { id: resetRecord.id }, data: { used: true } });

    // 4. Update Password if provided
    if (password) {
        const hashedPassword = await bcrypt.hash(password, 12);
        
        if (isEmployee) {
             await this.prisma.customerEmployee.update({
                where: { id: customer.id },
                data: {
                    password: hashedPassword,
                    mustChangePassword: false, // They just set it
                    // @ts-ignore
                    inviteToken: null,
                }
             });
        } else {
            let metadata = {};
            try {
                metadata = JSON.parse(customer.metadata as string || '{}');
            } catch (e) {}
            
            // @ts-ignore
            metadata.password = hashedPassword;
            
            await this.prisma.customer.update({
                where: { id: customer.id },
                data: { 
                    metadata: JSON.stringify(metadata),
                    // @ts-ignore
                    inviteToken: null, 
                }
            });
        }
    } else {
        // Just clear invite token
        // If password wasn't provided, they might be logging in via invite without resetting? 
        // Or maybe they just verified email. 
        // But usually invite requires setting password.
        // We'll clear the token anyway to "activate" it.
        if (isEmployee) {
             await this.prisma.customerEmployee.update({
                where: { id: customer.id },
                // @ts-ignore
                data: { inviteToken: null }
             });
        } else {
             await this.prisma.customer.update({
                where: { id: customer.id },
                // @ts-ignore
                data: { inviteToken: null }
            });
        }
    }

    // Generate Token
    let jwt;
    if (isEmployee) {
        // Generate Employee Token
        jwt = this.jwtService.sign({
            sub: employeeData.id,
            email: employeeData.email,
            tenantId: employeeData.customer.tenantId, // Use employer's tenant
            type: 'customer_employee',
            employeeId: employeeData.id,
            customerId: employeeData.customer.id
        });
    } else {
        // Generate Customer Token
        jwt = this.jwtService.sign({
            sub: customer.id,
            email: customer.email,
            tenantId: customer.tenantId,
            type: 'customer',
        });
    }



    // Fetch tenant subdomain for redirection
    const tenant = await this.prisma.tenant.findUnique({
        where: { id: isEmployee ? employeeData.customer.tenantId : customer.tenantId },
        select: { subdomain: true }
    });

    return {
        token: jwt,
        customer: {
            id: customer.id,
            email: customer.email,
            firstName: isEmployee ? (customer.name ? customer.name.split(' ')[0] : '') : customer.firstName,
            lastName: isEmployee ? (customer.name ? customer.name.split(' ').slice(1).join(' ') : '') : customer.lastName,
            phone: customer.phone,
            isEmployee: isEmployee,
            tenant: tenant ? { subdomain: tenant.subdomain } : undefined
        },
        message: 'Account verified and logged in'
    };
  }

  async getCustomerById(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async getCustomerByEmail(tenantId: string, email: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async updateCustomer(tenantId: string, customerId: string, updateCustomerDto: UpdateCustomerDto) {
    this.logger.log(`ًں”چ updateCustomer attempt: tenantId="${tenantId}", customerId="${customerId}"`);

    // Verify customer exists and belongs to tenant
    let existingCustomer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
    });

    if (!existingCustomer) {
      this.logger.warn(`â‌Œ Customer NOT found with id=${customerId} AND tenantId=${tenantId}. Trying by ID only...`);
      
      // Resilient check: search across ALL tenants to see if ID exists
      existingCustomer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });
      
      if (existingCustomer) {
         this.logger.log(`â„¹ï¸ڈ Customer found by ID only. Real tenantId is: ${existingCustomer.tenantId}. Proceeding with update...`);
         // We found the customer, so we trust it because the ID came from a validated JWT
      } else {
        this.logger.warn(`â‌Œ Customer NOT found at all with id=${customerId}`);
        throw new NotFoundException('Customer not found');
      }
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customerId },
      data: updateCustomerDto as any,
    });

    this.logger.log(`âœ… Customer updated: ${customerId}`);
    return updatedCustomer;
  }

  async getCustomers(tenantId: string, page: number = 1, limit: number = 50, search?: string) {
    const skip = (page - 1) * limit;

    const whereClause: { tenantId: string; OR?: unknown[] } = { tenantId };

    if (search) {
      whereClause.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
        },
      }),
      this.prisma.customer.count({
        where: whereClause,
      }),
    ]);

    return {
      data: customers,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  async deleteCustomer(tenantId: string, customerId: string) {
    // Verify customer exists and belongs to tenant
    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
        // recoveryId, // Removed as it's not needed for deletion
      },
    });

    if (!existingCustomer) {
      throw new NotFoundException('Customer not found');
    }

    // Invalidate all refresh tokens for this customer before deletion
    await this.prisma.refreshToken.deleteMany({
      where: { customerId },
    });

    // Delete the customer (cascade will handle related records)
    await this.prisma.customer.delete({
      where: { id: customerId },
    });

    this.logger.log(`âœ… Customer deleted: ${customerId}`);
    return { message: 'Customer deleted successfully' };
  }

  async forceLogoutCustomer(tenantId: string, customerId: string) {
    // Verify customer exists and belongs to tenant
    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
    });

    if (!existingCustomer) {
      throw new NotFoundException('Customer not found');
    }

    // Invalidate all refresh tokens for this customer
    const deletedCount = await this.prisma.refreshToken.deleteMany({
      where: { customerId },
    });

    this.logger.log(`âœ… Force logout customer: ${customerId}, invalidated ${deletedCount.count} tokens`);
    return { message: 'Customer logged out successfully', tokensInvalidated: deletedCount.count };
  }

  async updateCustomerEmailSettings(tenantId: string, customerId: string, emailDisabled: boolean) {
    // Verify customer exists and belongs to tenant
    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
    });

    if (!existingCustomer) {
      throw new NotFoundException('Customer not found');
    }

    // Update metadata to store email settings
    let metadata = {};
    try {
      metadata = existingCustomer.metadata ? JSON.parse(existingCustomer.metadata) : {};
    } catch {
      metadata = {};
    }

    metadata = {
      ...metadata,
      emailDisabled,
      emailSettingsUpdatedAt: new Date().toISOString(),
    };

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        metadata: JSON.stringify(metadata),
      },
    });

    this.logger.log(`âœ… Customer email settings updated: ${customerId}, emailDisabled: ${emailDisabled}`);
    return { message: 'Email settings updated successfully', emailDisabled };
  }

  async getCustomerStats(tenantId: string) {
    const totalCustomers = await this.prisma.customer.count({
      where: { tenantId },
    });

    const recentCustomers = await this.prisma.customer.count({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
    });

    return {
      totalCustomers,
      recentCustomers,
      growthRate: totalCustomers > 0 ? (recentCustomers / totalCustomers) * 100 : 0,
    };
  }

  async createOrUpdateCustomer(tenantId: string, customerData: CreateCustomerDto) {
    try {
      return await this.createCustomer(tenantId, customerData);
    } catch (error) {
      if (error instanceof ConflictException) {
        // Customer exists, update instead
        const existingCustomer = await this.getCustomerByEmail(tenantId, customerData.email);
        return this.updateCustomer(tenantId, existingCustomer.id, customerData);
      }
      throw error;
    }
  }

  /**
   * Change password for authenticated customer
   */
  async changePassword(customerId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    try {
      // Get customer
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      // Parse metadata to get password
      let metadata: any = {};
      try {
        metadata = typeof customer.metadata === 'string' 
          ? JSON.parse(customer.metadata) 
          : (customer.metadata || {});
      } catch (error) {
        this.logger.error('Failed to parse customer metadata:', error);
        throw new BadRequestException('Invalid account data');
      }

      if (!metadata.password) {
        throw new BadRequestException('Account does not have a password set');
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, metadata.password);
      if (!isCurrentPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update metadata with new password
      metadata.password = hashedPassword;

      await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          metadata: JSON.stringify(metadata),
        },
      });

      this.logger.log(`Success Password changed for customer: ${customer.email}`);
      return { message: 'Password changed successfully' };
    } catch (error: any) {
      this.logger.error(`Error Password change failed for customer ${customerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Setup 2FA for a customer during signup (public endpoint, uses email + access token)
   * The access token is used to verify the customer just signed up
   * We verify the token using JWT service and check it matches the email
   */
  async setupTwoFactorForSignup(tenantId: string, email: string, accessToken: string) {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Verify the access token is valid and belongs to this customer
    try {
      const decoded: any = this.authService['jwtService'].verify(accessToken);
      if (!decoded || decoded.email !== normalizedEmail) {
        throw new UnauthorizedException('Invalid token');
      }
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    
    // Find customer by email and tenant
    const customer = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: normalizedEmail,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    
    return this.setupTwoFactor(customer.id);
  }

  /**
   * Enable 2FA for a customer during signup
   */
  async enableTwoFactorForSignup(tenantId: string, email: string, accessToken: string, secret: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Verify the access token is valid and belongs to this customer
    try {
      const decoded: any = this.authService['jwtService'].verify(accessToken);
      if (!decoded || decoded.email !== normalizedEmail) {
        throw new UnauthorizedException('Invalid token');
      }
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    
    // Find customer by email and tenant
    const customer = await this.prisma.customer.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: normalizedEmail,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    
    return this.enableTwoFactor(customer.id, secret, code);
  }

  /**
   * Setup 2FA for a customer
   */
  async setupTwoFactor(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { tenant: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const secret = authenticator.generateSecret();
    const platformName = process.env.PLATFORM_NAME || 'Koun';
    const storeName = customer.tenant?.name || platformName;
    
    const otpauth = authenticator.keyuri(
      customer.email,
      storeName,
      secret,
    );

    const qrCode = await QRCode.toDataURL(otpauth);

    return {
      secret,
      qrCode,
    };
  }

  /**
   * Enable 2FA for a customer
   */
  async enableTwoFactor(customerId: string, secret: string, code: string) {
    const isValid = authenticator.verify({
      token: code,
      secret: secret,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Generate recovery codes
    const recoveryCodes = this.generateRecoveryCodes();
    // Hash codes for storage
    const hashedCodes = await Promise.all(recoveryCodes.map(c => bcrypt.hash(c, 10)));

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: true,
        twoFactorRecoveryCodes: JSON.stringify(hashedCodes),
      },
    });

    return { 
      message: 'Two-factor authentication enabled successfully',
      recoveryCodes, // Return plain codes to user once
    };
  }

  /**
   * Setup 2FA during signup (using verification token)
   */
  async setupTwoFactorDuringSignup(email: string, token: string) {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.email !== email) {
        throw new UnauthorizedException('Invalid token');
      }
      return this.setupTwoFactor(payload.sub);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Enable 2FA during signup
   */
  async enableTwoFactorDuringSignup(email: string, token: string, secret: string, code: string) {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.email !== email) {
        throw new UnauthorizedException('Invalid token');
      }
      return this.enableTwoFactor(payload.sub, secret, code);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Generate 8 recovery codes
   */
  private generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      // Generate 10-character alphanumeric codes
      codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
    }
    return codes;
  }

  /**
   * Disable 2FA for a customer
   */
  async disableTwoFactor(customerId: string, code: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer || !customer.twoFactorEnabled || !customer.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: customer.twoFactorSecret,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
      },
    });

    return { message: 'Two-factor authentication disabled successfully' };
  }

  /**
   * Verify 2FA code during login
   */
  async verifyLogin2FA(customerId: string, code: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer || !customer.twoFactorEnabled || !customer.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor authentication is not enabled or customer not found');
    }

    // Check if it's a TOTP code (6 digits)
    let isValid = false;
    let isRecoveryCode = false;

    if (/^\d{6}$/.test(code)) {
      isValid = authenticator.verify({
        token: code,
        secret: customer.twoFactorSecret,
      });
    } else {
      // Check recovery codes
      if (customer.twoFactorRecoveryCodes) {
        try {
          const recoveryCodes = JSON.parse(customer.twoFactorRecoveryCodes);
          if (Array.isArray(recoveryCodes)) {
            for (let i = 0; i < recoveryCodes.length; i++) {
              const isMatch = await bcrypt.compare(code, recoveryCodes[i]);
              if (isMatch) {
                isValid = true;
                isRecoveryCode = true;
                
                // Remove used code
                recoveryCodes.splice(i, 1);
                await this.prisma.customer.update({
                  where: { id: customerId },
                  data: { twoFactorRecoveryCodes: JSON.stringify(recoveryCodes) },
                });
                
                this.logger.log(`âœ… Used recovery code for customer: ${customerId}`);
                break;
              }
            }
          }
        } catch (e) {
          this.logger.error(`Failed to parse recovery codes for customer ${customerId}: ${e}`);
        }
      }
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Generate JWT tokens
    const tokens = await this.authService.generateTokens(customer, true);

    this.logger.log(`Success Customer logged in via 2FA: ${customer.id}`);

    return {
      token: tokens.accessToken, // Keep for backward compatibility
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
      },
    };
  }

  /**
   * Send SMS OTP via app-core service
   */
  private async sendSMSOTP(phone: string, code: string, tenantId: string): Promise<boolean> {
    const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3002';
    try {
      this.logger.log(' Attempting to send SMS OTP to ' + phone + ' for tenant ' + tenantId);
      
      const payload = {
        tenantId,
        to: phone,
        message: 'Your verification code for ' + (process.env.PLATFORM_NAME || 'Saeaa') + ' is: ' + code,
        messageAr: 'رمز التحقق الخاص بك لـ ' + (process.env.PLATFORM_NAME_AR || 'سعة') + ' هو: ' + code,
      };

      await firstValueFrom(
        this.httpService.post(coreApiUrl + '/api/notifications/sms', payload)
      );
      
      return true;
    } catch (error: any) {
      this.logger.error(' SMS OTP delivery failed: ' + error.message);
      return false;
    }
  }
}

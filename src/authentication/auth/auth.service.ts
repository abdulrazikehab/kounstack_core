import { Injectable, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException, Logger, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { RateLimitingService } from '../../rate-limiting/rate-limiting.service';
import { SignUpDto, SignUpResponseDto } from '../dto/signup.dto';
import { LoginDto, LoginResponseDto } from '../dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from '../dto/password.dto';
import { validateEmailWithMx, validateEmailWithKickbox, generateRecoveryId } from '../../utils/email-validator';
import { checkIpReputation } from '../../utils/ip-checker';
import { validatePasswordOrThrow } from '../../utils/password-policy.util';
import { EncryptionUtil } from '../../utils/encryption.util';
import { Prisma } from '@prisma/client';
const { authenticator } = require('otplib');
import * as QRCode from 'qrcode';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private pendingSignups: Map<string, any> = new Map(); // Temporary storage for pending signups

  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private rateLimitingService: RateLimitingService,
    private httpService: HttpService,
  ) {}

  async testDatabaseConnection() {
    try {
      const userCount = await this.prismaService.user.count();
      this.logger.log('✅ Database connection test successful');
      return userCount;
    } catch (error) {
      this.logger.error('❌ Database connection test failed:', error);
      throw error;
    }
  }

  /**
   * Create a test security event for testing purposes
   */
  async createTestSecurityEvent(ipAddress: string, userAgent: string) {
    // SECURITY FIX: Disable in production
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Test endpoints are disabled in production');
    }

    // Use a public IP for testing if localhost is passed
    const testIp = ipAddress.includes('127.0.0.1') || ipAddress.includes('::1') 
      ? '8.8.8.8' // Use Google's DNS IP for testing (will show as US)
      : ipAddress;

    this.logger.log(`🧪 Creating test security event with IP: ${testIp}, UA: ${userAgent}`);

    await this.logSecurityEvent(
      'SUCCESSFUL_LOGIN',
      'LOW',
      undefined,
      undefined,
      testIp,
      userAgent,
      'Test security event for development',
      { test: true }
    );

    return {
      ipAddress: testIp,
      userAgent: userAgent.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate subdomain from store name
   * Converts to lowercase, removes special characters, replaces spaces with hyphens
   */
  private generateSubdomain(storeName: string): string {
    return storeName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .substring(0, 63); // Limit to 63 characters (DNS subdomain limit)
  }

  async signUp(signUpDto: SignUpDto, fingerprint?: any, ipAddress?: string): Promise<SignUpResponseDto> {
    const emailForError = signUpDto?.email || 'unknown';
    try {
      let { email, password, name, storeName, subdomain, nationalId, phone } = signUpDto;
      
      // Normalize email to lowercase
      if (email) {
        email = email.toLowerCase().trim();
      }
      
      // Validate required fields
      if (!nationalId || !nationalId.trim()) {
        throw new BadRequestException('National ID or Passport ID is required');
      }

      if (!email || !password) {
        throw new BadRequestException('Email and password are required');
      }

      // Validate email - local check (fast) + Kickbox API check (only on signup)
      const emailValidation = await validateEmailWithKickbox(email);
      if (!emailValidation.isValid) {
        this.logger.warn(`Signup attempted with invalid email: ${email} - ${emailValidation.reason}`);
        throw new BadRequestException(emailValidation.reason || 'Invalid email address');
      }

      // SECURITY FIX: Validate password against policy
      validatePasswordOrThrow(password, undefined, { email, username: email.split('@')[0] });

      // Check device fingerprint
      if (fingerprint) {
          await this.checkDeviceFingerprint(fingerprint, email, 'unknown');
      }

      // Check rate limiting for signup - Use IP if available, fallback to email
      const rateLimitingKey = ipAddress && ipAddress !== 'unknown' ? ipAddress : email;
      this.logger.log(`🔍 Rate limiting signup for ${email} using key: ${rateLimitingKey}`);
      
      const signupConfig = this.rateLimitingService.getSignupConfig();
      const rateLimitCheck = await this.rateLimitingService.checkRateLimit(
        rateLimitingKey,
        'REGISTRATION',
        signupConfig.maxAttempts,
        signupConfig.windowMs
      );

      if (!rateLimitCheck.allowed) {
        this.logger.warn(`🚩 Rate limit exceeded for merchant signup: ${email}, Key: ${rateLimitingKey}, resets at: ${rateLimitCheck.resetTime}`);
        throw new ForbiddenException(`Too many signup attempts. Please try again after ${Math.ceil((rateLimitCheck.resetTime.getTime() - Date.now()) / 60000)} minutes.`);
      }

      // Check if user already exists
      const existingUser = await this.prismaService.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        // SECURITY FIX: Prevent user enumeration
        return {
            email,
            emailVerified: false,
            verificationCodeSent: false,
            verificationCode: process.env.NODE_ENV === 'development' ? 'USER_EXISTS' : undefined
        } as any;
      }

      // Check for existing pending signup (use normalized email)
      const existingPending = await this.prismaService.passwordReset.findFirst({
        where: {
          email: email, 
          used: false,
          expiresAt: { gt: new Date() },
          code: { startsWith: 'SIGNUP_' },
        },
      });

      if (existingPending) {
        this.logger.log(`Found existing pending signup for ${email}, cleaning up...`);
        await this.prismaService.passwordReset.delete({ where: { id: existingPending.id } });
      }

      // Generate OTP code (mark with SIGNUP_ prefix)
      const verificationCode = this.generateResetCode();
      const signupCode = `SIGNUP_${verificationCode}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Hash password before storing
      const hashedPassword = await bcrypt.hash(password, 12);

      // SECURITY FIX: Encrypt National ID before storage
      const encryptedNationalId = EncryptionUtil.encrypt(nationalId);

      const signupData = {
        email,
        password: hashedPassword,
        name,
        storeName,
        nationalId: encryptedNationalId,
        phone,
        fingerprint,
      };

      try {
        this.logger.log(`Storing signup code for ${email}`);
        await this.prismaService.passwordReset.create({
          data: {
            email: email, 
            code: signupCode, 
            expiresAt,
            signupData: JSON.stringify(signupData), 
          },
        });
      } catch (dbError) {
        this.logger.warn(`Failed to store signupData in DB, falling back...`);
        await this.prismaService.passwordReset.create({
          data: {
            email: email,
            code: signupCode,
            expiresAt,
          },
        });
      }

      if (!this.pendingSignups) {
        this.pendingSignups = new Map();
      }
      this.pendingSignups.set(`${email}_${verificationCode}`, signupData);

      // Send notifications
      let emailSent = false;
      let smsSent = false;
      let emailError: any = null;
      let emailResult: any = null;
      
      try {
        this.logger.log(`📧 Sending OTP email to ${email}`);
        emailResult = await this.emailService.sendVerificationEmail(
          email, 
          verificationCode, 
          undefined, 
          signUpDto.storeName // Pass store name from signup DTO
        );
        emailSent = true;
        this.logger.log(`✅ Email sent successfully to ${email}`);
      } catch (error) {
        emailError = error;
        this.logger.error(`❌ Email sending failed: ${error instanceof Error ? error.message : String(error)}`);
        emailResult = { messageId: 'failed', previewUrl: '', isTestEmail: false };
      }

      // Send SMS if phone is available
      if (phone) {
        try {
          smsSent = await this.sendSMSOTP(phone, verificationCode);
          if (smsSent) this.logger.log(`✅ SMS OTP sent successfully to ${phone}`);
        } catch (smsError: any) {
          this.logger.error(`❌ SMS OTP sending failed: ${smsError.message}`);
        }
      }

      const overallSuccess = emailSent || smsSent;
      
      // In production, if both fail, cleanup and throw error
      if (!overallSuccess && process.env.NODE_ENV !== 'development') {
         await this.prismaService.passwordReset.deleteMany({ where: { email, code: signupCode } });
         this.pendingSignups.delete(`${email}_${verificationCode}`);
         const errorMessage = emailError instanceof Error ? emailError.message : 'Email and SMS services are unavailable';
         this.logger.error(`❌ Production mode: Blocking signup due to notification failure: ${errorMessage}`);
         throw new BadRequestException(`Cannot send verification code at this time. Please try again later or contact support.`);
      }

      // Build response
      const response: any = {
        email,
        emailVerified: false,
        verificationCodeSent: overallSuccess,
      };

      // Add warnings/info if using test email or email failed
      if (emailSent && emailResult) {
        if (emailResult.isTestEmail || emailResult.previewUrl) {
          response.emailWarning = 'Using test email service. Check preview URL or use code below.';
          if (emailResult.previewUrl) {
            response.previewUrl = emailResult.previewUrl;
          }
        }
      } else if (!emailSent && process.env.NODE_ENV === 'development') {
        // Email failed but we're in development
        response.emailWarning = 'Email sending failed. Use the verification code below to complete signup.';
      }

      // Always include verification code in development (even if email failed)
      if (process.env.NODE_ENV === 'development') {
        response.verificationCode = verificationCode;
        response.debugInfo = {
          emailSent,
          smsSent,
          phone: phone || 'not provided',
          emailError: emailError ? (emailError instanceof Error ? emailError.message : String(emailError)) : null,
        };
      }
      
      this.logger.log(`✅ Signup initialized for: ${email}`);
      
      return response;
    } catch (error: any) {
      this.logger.error(`❌ Error in signUp method for ${emailForError}:`, error);
      
      if (error instanceof BadRequestException || 
          error instanceof ConflictException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Signup failed. Please try again later.');
    }
  }

  /**
   * Get the authenticated user's profile with flattened tenant info.
   * Used by both /auth/me and merchant auth endpoints.
   */
  async getUserProfile(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
          },
        },
        staffPermissions: {
          where: {
            // Only get non-metadata permissions (filter out employee:phone, employee:role, etc.)
            permission: {
              not: {
                startsWith: 'employee:',
              },
            },
          },
          select: {
            permission: true,
          },
        },
      },
    });

    if (!user) {
      // Check if it's a Customer Employee
      const employee = await this.prismaService.customerEmployee.findUnique({
        where: { id: userId },
        include: { permissions: true }
      });

      if (employee) {
         const customer = await this.prismaService.user.findUnique({
             where: { id: employee.customerId },
             include: { tenant: true }
         });

         if (!customer) throw new NotFoundException('Employer not found');

         return {
             id: employee.id,
             email: employee.email,
             role: 'CUSTOMER_EMPLOYEE',
             tenantId: customer.tenantId,
             tenantName: customer.tenant?.name,
             tenantSubdomain: customer.tenant?.subdomain,
             permissions: employee.permissions.map((p: any) => p.permission),
             employerEmail: customer.email,
             avatar: null,
             createdAt: employee.createdAt,
             updatedAt: employee.updatedAt,
         };
      }

      throw new NotFoundException('User not found');
    }

    // Extract permission strings from staffPermissions array
    const permissions = user.staffPermissions?.map((sp: { permission: string }) => sp.permission) || [];

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      avatar: user.avatar,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      tenantName: user.tenant?.name,
      tenantSubdomain: user.tenant?.subdomain,
      permissions: permissions, // Include permissions for staff users
    };
  }

  async verifySignupCode(email: string, code: string): Promise<{ valid: boolean; message: string; tokens?: any; recoveryId?: string; tenantId?: string; setupPending?: boolean; user?: any }> {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find the signup verification code (with SIGNUP_ prefix)
    const signupCode = `SIGNUP_${code}`;
    
    this.logger.log(`🔍 Verifying signup code for ${normalizedEmail}: ${signupCode}`);
    
    const resetRecord = await this.prismaService.passwordReset.findFirst({
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
        signupData: true, // Explicitly select signupData field
      },
    });

    if (!resetRecord) {
      this.logger.warn(`❌ No pending signup record found for ${normalizedEmail} with code ${signupCode} (or it is expired/used)`);
      await this.logSecurityEvent(
        'INVALID_VERIFICATION_CODE',
        'LOW',
        undefined,
        undefined,
        undefined,
        undefined,
        `Invalid verification code attempt for email: ${email}`
      );
      return {
        valid: false,
        message: 'Invalid or expired verification code',
      };
    }

    // Get signup data from database (production-safe, works across instances)
    // Fallback to memory cache if available (faster, but not reliable in production)
    const signupDataKey = `${normalizedEmail}_${code}`;
    let signupData = this.pendingSignups.get(signupDataKey);

    this.logger.log(`🔍 Signup data in memory for ${signupDataKey}: ${!!signupData}`);

    // If not in memory, retrieve from database
    if (!signupData && resetRecord.signupData) {
      try {
        signupData = JSON.parse(resetRecord.signupData);
        this.logger.log(`✅ Retrieved signup data from database for: ${normalizedEmail}`);
        // Cache in memory for faster access
        this.pendingSignups.set(signupDataKey, signupData);
      } catch (parseError) {
        this.logger.error(`❌ Failed to parse signup data from database for ${normalizedEmail}: ${parseError}`);
      }
    }

    if (!signupData) {
      this.logger.error(`❌ CRITICAL: Signup data missing for ${normalizedEmail}. Memory: ${!!this.pendingSignups.get(signupDataKey)}, DB Field: ${!!resetRecord.signupData}`);
      
      return {
        valid: false,
        message: 'Signup session expired. Please sign up again.',
      };
    }

    // Validate signup data has required fields
    // NOTE: storeName and subdomain are NOT required - user will create store via setup page
    if (!signupData.nationalId) {
      this.logger.error(`Missing required signup data:`, {
        hasNationalId: !!signupData.nationalId,
        signupDataKeys: Object.keys(signupData),
      });
      throw new BadRequestException('Signup data is incomplete. Please sign up again.');
    }

    // Re-check if user already exists (race condition protection)
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // Clean up and return error
      await this.prismaService.passwordReset.update({
        where: { id: resetRecord.id },
        data: { used: true },
      });
      this.pendingSignups.delete(signupDataKey);
      throw new ConflictException('User already exists');
    }

    // Generate recovery ID
    const recoveryId = generateRecoveryId();

    // ============================================================
    // NOW CREATE THE USER ACCOUNT (ONLY after successful OTP verification)
    // This is the ONLY place where user is created during signup
    // NOTE: Tenant is NOT created during signup - user will create store via setup page
    // No user exists in database until this point!
    // ============================================================
    this.logger.log(`🔐 Creating user account for ${normalizedEmail} AFTER successful OTP verification`);
    this.logger.log(`📝 User will create store/market via setup page after login`);
    
    // Final check: Make absolutely sure user doesn't exist yet
    const finalUserCheck = await this.prismaService.user.findUnique({
      where: { email: normalizedEmail },
    });
    
    if (finalUserCheck) {
      this.logger.error(`❌ User already exists for ${normalizedEmail} - this should not happen!`);
      throw new ConflictException('User already exists. Cannot create duplicate account.');
    }
    
    // Generate username (subemail) from email
    const generatedUsername = normalizedEmail.split('@')[0].toLowerCase();

    // Create User only (NO tenant creation during signup)
    let result;
    try {
      result = await this.prismaService.$transaction(async (tx: Prisma.TransactionClient) => {
        // Create user WITHOUT tenant (tenantId will be null)
        // User will create store/market via setup page after login
        this.logger.log(`👤 Creating user with email: ${signupData.email}, nationalId: ${signupData.nationalId}`);
        const user = await tx.user.create({
          data: {
            email: signupData.email,
            username: generatedUsername,
            password: signupData.password,
            ...(signupData.name && { name: signupData.name }),
            nationalId: signupData.nationalId, // Already encrypted in signUp() before being put into signupData
            phone: signupData.phone,
            role: 'SHOP_OWNER',
            tenantId: null, // No tenant during signup - user will create store via setup page
            recoveryId,
            emailVerified: true, // Already verified via OTP
          },
        });
        this.logger.log(`✅ User created: ${user.id} (without tenant - will create store via setup page)`);

        return { user, tenant: null };
      });
    } catch (error: any) {
      this.logger.error(`❌ Transaction failed during signup verification:`, error);
      this.logger.error(`Error details:`, {
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
        stack: error?.stack,
      });
      
      // Clean up on error
      this.pendingSignups.delete(signupDataKey);
      
      // Provide user-friendly error message
      if (error?.code === 'P2002') {
        // Unique constraint violation
        throw new ConflictException('Subdomain or email already exists. Please try a different store name or email.');
      } else if (error?.code === 'P2003') {
        // Foreign key constraint violation
        throw new BadRequestException('Invalid data provided. Please check your information and try again.');
      } else {
        throw new InternalServerErrorException('Failed to create account. Please contact support if the issue persists.');
      }
    }

    const { user } = result;

    // Mark code as used
    await this.prismaService.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    // Clean up pending signup data
    this.pendingSignups.delete(signupDataKey);

    // Log successful registration (NO tenant created - user will create store via setup page)
    await this.logAuditEvent(
      user.id,
      undefined, // No tenantId during signup
      'USER_REGISTERED',
      user.id,
      'user',
      undefined,
      { role: 'SHOP_OWNER' },
      { registrationMethod: 'email', hasRecoveryId: true, tenantCreated: false, setupPending: true }
    );

    // Generate tokens
    const fullUser = await this.prismaService.user.findUnique({
      where: { id: user.id },
      include: { tenant: true },
    });

    if (!fullUser) {
      throw new Error('User not found after creation');
    }

    const tokens = await this.generateTokens(fullUser);

    this.logger.log(`✅ Account created successfully for: ${normalizedEmail}`);
    this.logger.log(`📝 User will create store/market via setup page after login`);

    return {
      valid: true,
      message: 'Email verified successfully and account created',
      tokens,
      recoveryId, // Return recovery ID so user can save it
      tenantId: undefined, // No tenant during signup
      setupPending: true, // User needs to create store via setup page
      user: {
        id: fullUser.id,
        email: fullUser.email,
        name: fullUser.name,
        role: fullUser.role,
        tenantId: fullUser.tenantId,
        avatar: fullUser.avatar,
      },
    };
  }

  async resendVerificationCode(email: string, ipAddress?: string): Promise<{ message: string; previewUrl?: string; code?: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    // Check for pending signup (not existing user)
    const existingPending = await this.prismaService.passwordReset.findFirst({
      where: {
        email: normalizedEmail,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
        code: {
          startsWith: 'SIGNUP_',
        },
      },
      select: {
        id: true,
        email: true,
        code: true,
        expiresAt: true,
        used: true,
        signupData: true, // Explicitly select signupData field
      },
    });

    if (!existingPending) {
      // Don't reveal if signup exists
      return { message: 'If the email exists, a verification code has been sent' };
    }

    // Check if user already exists (shouldn't happen for pending signup)
    const user = await this.prismaService.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      // SECURITY FIX: Prevent account enumeration
      // If user already exists, we pretend we sent a code or just return generic message
      return { message: 'If the email exists, a verification code has been sent' };
    }

    // Get signup data from database (production-safe)
    // Try to get from existing pending record first
    let signupData = null;
    const oldCode = existingPending.code.replace('SIGNUP_', '');
    const signupDataKey = `${normalizedEmail}_${oldCode}`; // Use normalizedEmail for consistency
    
    if (existingPending.signupData) {
      try {
        signupData = JSON.parse(existingPending.signupData);
        this.logger.log(`✅ Retrieved signup data from database for resend: ${normalizedEmail}`);
      } catch (parseError) {
        this.logger.error(`Failed to parse signup data from database: ${parseError}`);
      }
    }
    
    // Fallback to memory cache
    if (!signupData) {
      signupData = this.pendingSignups.get(signupDataKey);
    }

    if (!signupData) {
      this.logger.error(`❌ Signup data not found for resend: ${normalizedEmail}_${oldCode}`);
      this.logger.error(`Has signupData in DB: ${!!existingPending.signupData}`);
      throw new BadRequestException('Pending signup not found. Please start signup again.');
    }

    // Check rate limiting - Use IP if available, fallback to email
    const rateLimitingKey = ipAddress && ipAddress !== 'unknown' ? ipAddress : normalizedEmail;
    
    const signupConfig = this.rateLimitingService.getSignupConfig();
    const rateLimitCheck = await this.rateLimitingService.checkRateLimit(
      rateLimitingKey,
      'REGISTRATION',
      signupConfig.maxAttempts,
      signupConfig.windowMs
    );

    if (!rateLimitCheck.allowed) {
      this.logger.warn(`🚩 Rate limit exceeded for verification resend: ${normalizedEmail}, Key: ${rateLimitingKey}`);
      throw new ForbiddenException(`Too many verification code requests. Please try again after ${Math.ceil((rateLimitCheck.resetTime.getTime() - Date.now()) / 60000)} minutes.`);
    }

    // Mark old code as used
    await this.prismaService.passwordReset.update({
      where: { id: existingPending.id },
      data: { used: true },
    });

    // Remove old pending signup from memory cache (if it exists)
    this.pendingSignups.delete(signupDataKey);

    // Generate new code
    const verificationCode = this.generateResetCode();
    const signupCode = `SIGNUP_${verificationCode}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    try {
      // Store new verification code with signup data in database
      await this.prismaService.passwordReset.create({
        data: {
          email: normalizedEmail, // Use normalized email for consistency
          code: signupCode,
          expiresAt,
          signupData: JSON.stringify(signupData), // Store signup data in database
        },
      });
    } catch (dbError) {
      this.logger.warn(`Failed to store signupData in DB for resend (schema might be outdated), falling back to basic create: ${dbError}`);
      // Fallback: Try creating without signupData
      await this.prismaService.passwordReset.create({
        data: {
          email: normalizedEmail,
          code: signupCode,
          expiresAt,
        },
      });
    }

    // Store signup data with new code in memory cache
    this.pendingSignups.set(`${normalizedEmail}_${verificationCode}`, signupData);

    // Send notifications
    let emailSent = false;
    let smsSent = false;
    let emailResult: any;

    try {
      emailResult = await this.emailService.sendVerificationEmail(
        normalizedEmail, 
        verificationCode,
        undefined,
        signupData.storeName || signupData.name // Use storeName from cached signup data if available
      );
      emailSent = true;
      this.logger.log(`✅ Resent verification email to ${normalizedEmail}`);
    } catch (emailError: any) {
      this.logger.error(`❌ Email resend failed: ${emailError.message}`);
    }

    // Send SMS if phone is available
    if (signupData.phone) {
      try {
        smsSent = await this.sendSMSOTP(signupData.phone, verificationCode);
        if (smsSent) this.logger.log(`✅ Resent SMS OTP to ${signupData.phone}`);
      } catch (smsError: any) {
        this.logger.error(`❌ SMS OTP resend failed: ${smsError.message}`);
      }
    }

    const overallSuccess = emailSent || smsSent;

    if (!overallSuccess && process.env.NODE_ENV !== 'development') {
      throw new InternalServerErrorException('Failed to resend verification code via Email or SMS');
    }

    const response: any = {
      message: 'Verification code has been sent',
      previewUrl: emailResult?.previewUrl,
    };

    if (process.env.NODE_ENV === 'development') {
      response.verificationCode = verificationCode;
    }

    return response;
  }

  private async sendSMSOTP(phone: string, code: string): Promise<boolean> {
    const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3002';
    try {
      this.logger.log(`📲 Attempting to send SMS OTP to ${phone} via Core API`);
      this.logger.log(`📲 Core API URL: ${coreApiUrl} (configured via CORE_API_URL env var)`);
      this.logger.log(`📲 Full Endpoint: ${coreApiUrl}/api/notifications/sms`);
      
      const payload = {
        tenantId: 'merchant_signup',
        to: phone,
        message: 'Your verification code for ' + (process.env.PLATFORM_NAME || 'Saeaa') + ' is: ' + code,
        messageAr: 'رمز التحقق الخاص بك لـ ' + (process.env.PLATFORM_NAME_AR || 'سعة') + ' هو: ' + code,
      };

      const response = await firstValueFrom(
        this.httpService.post(coreApiUrl + '/api/notifications/sms', payload)
      );
      
      this.logger.log(`✅ Core API response for SMS: ${response.status}`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ SMS OTP delivery failed via ${coreApiUrl}: ${error.message}`);
      if (error.response) {
        this.logger.error(`❌ Response error data: ${JSON.stringify(error.response.data)}`);
      }
      return false;
    }
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string, fingerprint?: any, subdomain?: string | null, tenantDomain?: string | null): Promise<LoginResponseDto> {
    let { email, username, password } = loginDto;
    
    // Normalize email
    if (email) {
      email = email.toLowerCase().trim();
    }
    
    const safeIpAddress = ipAddress || 'unknown';
    
    // Determine identifier for rate limiting and logging
    const identifier = email || username || 'unknown';
    
    // Extract subdomain from tenantDomain if not provided directly
    let resolvedSubdomain = subdomain;
    if (!resolvedSubdomain && tenantDomain) {
      // Extract subdomain from domain (e.g., "market.kawn.com" -> "market")
      if (tenantDomain.includes('.localhost')) {
        resolvedSubdomain = tenantDomain.split('.localhost')[0];
      } else if (tenantDomain.endsWith('.saeaa.com') || tenantDomain.endsWith('.saeaa.net')) {
        const parts = tenantDomain.split('.');
        if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'app') {
          resolvedSubdomain = parts[0];
        }
      }
    }

    // Find user by email or username
    let user;
    if (email) {
      user = await this.prismaService.user.findUnique({
        where: { email },
        include: { tenant: true },
      });
    } else if (username) {
      // Try to find by username (subemail)
      user = await this.prismaService.user.findFirst({
        where: { username: username.toLowerCase() },
        include: { tenant: true },
      });
    }

    // Check if it's a Customer Employee if no User found
    if (!user && email) {
      const employee = await this.prismaService.customerEmployee.findUnique({
        where: { email },
        include: { permissions: true }
      });

      if (employee) {
        // Verify password
        const isPasswordValid = await bcrypt.compare(password, employee.password);
        
        if (!isPasswordValid) {
           this.logger.warn(`❌ Login failed: Invalid password for employee: ${email}`);
           throw new UnauthorizedException('Invalid credentials');
        }

        // Get Customer (Employer)
        const customer = await this.prismaService.user.findUnique({
             where: { id: employee.customerId },
             include: { tenant: true }
        });

        if (!customer) {
            throw new UnauthorizedException('Employer account not found');
        }

        // Generate tokens using employee data but linked to customer's tenant
        const employeeUser: any = {
            id: employee.id,
            email: employee.email,
            role: 'CUSTOMER_EMPLOYEE', 
            tenantId: customer.tenantId,
        };

        const tokens = await this.generateTokens(employeeUser);

        this.logger.log(`✅ Login successful for employee: ${employee.email} (Employer: ${customer.email})`);

        return {
            id: employee.id,
            email: employee.email,
            role: 'CUSTOMER_EMPLOYEE',
            tenantId: customer.tenantId,
            tenantName: customer.tenant?.name,
            tenantSubdomain: customer.tenant?.subdomain,
            permissions: employee.permissions.map((p: any) => p.permission),
            employerEmail: customer.email,
            mustChangePassword: employee.mustChangePassword || false, // Include flag for first login password change
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
      }
    }

    const isAdmin = user?.role === 'SUPER_ADMIN';

    // Validate email format - check for fake/disposable emails (Skip for Admin, skip if using username)
    // if (!isAdmin && email) {
    //   const emailValidation = await validateEmailWithMx(email);
    //   if (!emailValidation.isValid) {
    //     this.logger.warn(`Login attempted with invalid email: ${email} - ${emailValidation.reason}`);
    //     throw new BadRequestException(emailValidation.reason || 'Invalid email address');
    //   }
    // }

    // SECURITY FIX: Enforce device fingerprint check (Skip for Admin)
    /*
    if (!isAdmin) {
      if (fingerprint) {
        try {
          await this.checkDeviceFingerprint(fingerprint, identifier, safeIpAddress, userAgent);
        } catch (e) {
          // SECURITY FIX: Block login if fingerprint check fails
          this.logger.error('Fingerprint check failed, blocking login:', e);
          await this.logSecurityEvent(
            'FINGERPRINT_CHECK_FAILED',
            'HIGH',
            user?.id,
            user?.tenantId,
            safeIpAddress,
            userAgent,
            `Device fingerprint validation failed for ${identifier}`
          );
          throw new UnauthorizedException('Device verification failed. Please try again or contact support.');
        }
      } else if (process.env.REQUIRE_DEVICE_FINGERPRINT === 'true') {
        // Optional: Require fingerprint if configured
        this.logger.warn('Device fingerprint required but not provided');
        throw new UnauthorizedException('Device verification required. Please enable JavaScript and try again.');
      }
    }
    */

    // Check rate limiting for login attempts
    // We still apply rate limiting for admin to prevent brute force on admin account, 
    // but we could increase limits if needed. For now, standard limits apply.
    const loginConfig = this.rateLimitingService.getLoginConfig();
    const rateLimitCheck = await this.rateLimitingService.checkRateLimit(
      identifier, 
      'LOGIN', 
      loginConfig.maxAttempts,
      loginConfig.windowMs
    );

    if (!rateLimitCheck.allowed) {
      await this.logSecurityEvent(
        'BRUTE_FORCE_ATTEMPT',
        'HIGH',
        undefined,
        undefined,
        safeIpAddress,
        userAgent,
        `Rate limited login attempts for: ${identifier}`
      );
      throw new ForbiddenException(`Too many login attempts. Please try again after ${Math.ceil((rateLimitCheck.resetTime.getTime() - Date.now()) / 60000)} minutes.`);
    }

    this.logger.log(`🔧 Login attempt for: ${identifier} from IP: ${safeIpAddress}`);

    if (!user) {
      // User not found (and we already checked rate limit)
      this.logger.warn(`❌ Login failed: User not found - ${identifier}`);
      await this.logSecurityEvent(
        'FAILED_LOGIN_ATTEMPT',
        'LOW',
        undefined,
        undefined,
        safeIpAddress,
        userAgent,
        `Failed login attempt for non-existent user: ${identifier}`
      );
      throw new UnauthorizedException(`User not found with email/username: ${identifier}`);
    }

    // Log user found for debugging
    this.logger.log(`✅ User found: ${user.email}, emailVerified: ${user.emailVerified}, role: ${user.role}, tenantId: ${user.tenantId}`);

    // Validate subdomain if provided (for multi-tenant login)
    if (resolvedSubdomain && !isAdmin) {
      if (user.tenant?.subdomain) {
        // User has a tenant - validate subdomain matches
        if (user.tenant.subdomain !== resolvedSubdomain) {
          this.logger.warn(`❌ Subdomain mismatch: user tenant is "${user.tenant.subdomain}", login attempted from "${resolvedSubdomain}"`);
          throw new UnauthorizedException(`Subdomain mismatch: Your account belongs to '${user.tenant.subdomain}', but you are logging in from '${resolvedSubdomain}'.`);
        }
        this.logger.log(`✅ Subdomain validated: ${resolvedSubdomain} matches user's tenant`);
      } else {
        // User doesn't have a tenant yet - this is allowed for initial setup
        this.logger.log(`ℹ️ User has no tenant yet - allowing login for setup (subdomain: ${resolvedSubdomain})`);
      }
    }

    // Account lock check is handled in AuthController

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      this.logger.warn(`❌ Login failed: Invalid password for user: ${user.email} (Input password length: ${password?.length}, Hash length: ${user.password?.length})`);
      await this.logSecurityEvent(
        'SUSPICIOUS_LOGIN',
        'MEDIUM',
        user.id,
        user.tenantId,
        safeIpAddress,
        userAgent,
        `Failed login attempt with wrong password for user: ${user.email}`
      );
      throw new UnauthorizedException('Invalid password provided.');
    }

    this.logger.log(`✅ Password validated for user: ${user.email}`);
    
    // SECURITY FIX: Always enforce email verification for non-admin users
    // if (!isAdmin && !user.emailVerified) {
    //   this.logger.warn(`❌ Login blocked: email not verified for user: ${user.email}`);
    //   throw new UnauthorizedException('Email not verified. Please verify your email before logging in. Check your inbox for the verification code.');
    // } else if (user.emailVerified) {
    //   this.logger.log(`✅ Email verified for user: ${user.email}`);
    // }

    // Successful login attempt recording is handled in AuthController

    // Log successful login as security event (for tracking location/device)
    await this.logSecurityEvent(
      'SUCCESSFUL_LOGIN',
      'LOW',
      user.id,
      user.tenantId,
      safeIpAddress,
      userAgent,
      `Successful login for user: ${user.email}`,
      { loginMethod: 'email_password' }
    );

    // Fix: Ensure user_tenants record exists if user has tenantId
    // This handles backward compatibility for users created before user_tenants table
    // The backend expects a record in user_tenants to allow login
    if (user.tenantId) {
      try {
        // Use existing linkUserToTenant method to ensure consistency
        await this.linkUserToTenant(user.id, user.tenantId, true);
        this.logger.log(`✅ Ensured user_tenants record exists for user ${user.id} and tenant ${user.tenantId}`);
      } catch (error) {
        // If tenant doesn't exist or other error, log warning but don't fail login
        // This allows users without valid tenants to still log in
        this.logger.warn(`⚠️ Could not link user to tenant during login: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (user.role === 'SHOP_OWNER' && !isAdmin) {
      // User is a SHOP_OWNER but has no tenant.
      // We no longer auto-create a tenant here.
      // Instead, the frontend will redirect them to the setup page (/setup)
      // where they can create their store with a custom name and subdomain.
      this.logger.log(`ℹ️ SHOP_OWNER user ${user.id} (${user.email}) has no tenant. Redirect to setup expected.`);
    }

    // Log successful login as audit event
    await this.logAuditEvent(
      user.id,
      user.tenantId,
      'USER_LOGIN',
      user.id,
      'user',
      undefined,
      undefined,
      { loginMethod: 'email_password', ipAddress: safeIpAddress }
    );

    // If 2FA is enabled, return requiresTwoFactor instead of tokens
    if (user.twoFactorEnabled) {
      this.logger.log(`🔑 2FA required for user: ${user.email}`);
      return {
        id: user.id,
        email: user.email,
        username: user.username || undefined,
        role: user.role,
        tenantId: user.tenantId,
        requiresTwoFactor: true,
        customerId: user.id, // For the frontend to use in verifyLogin2FA, we treat user as customer for unified flow if needed or use same param name
      } as any;
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Get permissions for STAFF users
    let permissions: string[] | undefined = undefined;
    let mustChangePasswordFromEmployee = false;
    
    if (user.role === 'STAFF') {
      // Get staff permissions from StaffPermission table
      const staffPermissions = await this.prismaService.staffPermission.findMany({
        where: {
          userId: user.id,
          tenantId: user.tenantId || undefined,
        },
        select: {
          permission: true,
        },
      });
      permissions = staffPermissions.map((p: any) => p.permission);
    }

    this.logger.log(`✅ Login successful for user: ${user.email}`);
    return {
      id: user.id,
      email: user.email,
      username: user.username || undefined,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant?.name,
      tenantSubdomain: user.tenant?.subdomain,
      avatar: user.avatar,
      mustChangePassword: mustChangePasswordFromEmployee || user.mustChangePassword || false, // Include flag for first login password change
      permissions: permissions, // Include permissions for STAFF users
      twoFactorEnabled: user.twoFactorEnabled,
      ...tokens,
    };
  }

  /**
   * Login with recovery ID - allows users to recover access using their secret ID
   */
  async loginWithRecoveryId(recoveryId: string, password: string, ipAddress?: string, userAgent?: string): Promise<LoginResponseDto> {
    const safeIpAddress = ipAddress || 'unknown';

    // Normalize recovery ID (remove dashes, uppercase)
    const normalizedRecoveryId = recoveryId.replace(/-/g, '').toUpperCase();

    // Check rate limiting
    const rateLimitCheck = await this.rateLimitingService.checkRateLimit(
      `recovery:${normalizedRecoveryId}`,
      'LOGIN',
      10, // Fewer attempts allowed for recovery
      30 * 60 * 1000 // 30 minutes
    );

    if (!rateLimitCheck.allowed) {
      throw new ForbiddenException('Too many recovery attempts. Please try again later.');
    }

    // Find user by recovery ID
    const user = await this.prismaService.user.findFirst({
      where: {
        recoveryId: {
          equals: normalizedRecoveryId,
        },
      },
    });

    if (!user) {
      await this.logSecurityEvent(
        'SUSPICIOUS_LOGIN',
        'MEDIUM',
        undefined,
        undefined,
        safeIpAddress,
        userAgent,
        `Invalid recovery ID attempt`
      );
      throw new UnauthorizedException('Invalid recovery ID');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await this.logSecurityEvent(
        'SUSPICIOUS_LOGIN',
        'MEDIUM',
        user.id,
        user.tenantId,
        safeIpAddress,
        userAgent,
        `Failed recovery login: wrong password for user: ${user.email}`
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // If 2FA is enabled, return requiresTwoFactor instead of tokens
    if (user.twoFactorEnabled) {
      this.logger.log(`🔑 2FA required for user: ${user.email} (Recovery Login)`);
      return {
        id: user.id,
        email: user.email,
        username: user.username || undefined,
        role: user.role,
        tenantId: user.tenantId,
        requiresTwoFactor: true,
        customerId: user.id,
      } as any;
    }

    // Log successful recovery login
    await this.logAuditEvent(
      user.id,
      user.tenantId,
      'USER_LOGIN',
      user.id,
      'user',
      undefined,
      undefined,
      { loginMethod: 'recovery_id', ipAddress: safeIpAddress }
    );

    // Generate tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`✅ User logged in via recovery ID: ${user.email}`);

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      avatar: user.avatar,
      twoFactorEnabled: user.twoFactorEnabled,
      ...tokens,
    };
  }

  /**
   * Get user email by recovery ID (for "forgot email" feature)
   */
  async getEmailByRecoveryId(recoveryId: string): Promise<{ email: string; maskedEmail: string }> {
    // Try multiple formats
    const normalizedNoDashes = recoveryId.replace(/-/g, '').toUpperCase();
    const withDashes = recoveryId.toUpperCase();
    const original = recoveryId;

    this.logger.log(`Looking for recovery ID: original="${original}", noDashes="${normalizedNoDashes}", withDashes="${withDashes}"`);

    // Try exact match first, then normalized versions
    const user = await this.prismaService.user.findFirst({
      where: {
        OR: [
          { recoveryId: original },
          { recoveryId: withDashes },
          { recoveryId: normalizedNoDashes },
        ],
      },
      select: {
        email: true,
        recoveryId: true,
      },
    });

    if (!user) {
      this.logger.warn(`Recovery ID not found: ${recoveryId}`);
      throw new NotFoundException('Invalid recovery ID');
    }

    this.logger.log(`Found user with recovery ID: ${user.recoveryId}`);

    // Mask email for security (show only first 2 chars and domain)
    const [localPart, domain] = user.email.split('@');
    const maskedLocal = localPart.substring(0, 2) + '***';
    const maskedEmail = `${maskedLocal}@${domain}`;

    return {
      email: user.email,
      maskedEmail,
    };
  }

  /**
   * Recover email by recovery ID - returns masked email for user verification
   * This is a public endpoint - no password required
   */
  async recoverEmailByRecoveryId(recoveryId: string): Promise<{ success: boolean; maskedEmail: string; message: string }> {
    try {
      const result = await this.getEmailByRecoveryId(recoveryId);
      return {
        success: true,
        maskedEmail: result.maskedEmail,
        message: `Your email is: ${result.maskedEmail}`,
      };
    } catch (error) {
      throw new BadRequestException('Invalid recovery ID. Please check and try again.');
    }
  }

  /**
   * Send password reset email using recovery ID
   * This allows users who forgot their email to still reset their password
   */
  async sendPasswordResetByRecoveryId(recoveryId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get the user's email by recovery ID
      const result = await this.getEmailByRecoveryId(recoveryId);
      
      // Now send the password reset email using the actual email
      await this.forgotPassword({ email: result.email }, 'recovery_id');
      
      return {
        success: true,
        message: 'Password reset email sent successfully',
      };
    } catch (error) {
      // For security, don't reveal if recovery ID was invalid
      throw new BadRequestException('Failed to send reset email. Please check your recovery ID.');
    }
  }

  async refreshTokens(refreshToken: string) {
    try {
      const refreshSecret = process.env.JWT_REFRESH_SECRET;
      if (!refreshSecret) {
        this.logger.error('JWT_REFRESH_SECRET is not configured');
        throw new UnauthorizedException('JWT_REFRESH_SECRET is not configured');
      }

      const hashedToken = this.hashToken(refreshToken);

      // SECURITY FIX: Verify refresh token exists in database and is valid (supports legacy plaintext)
      const storedToken = await this.prismaService.refreshToken.findFirst({
        where: { token: { in: [refreshToken, hashedToken] } },
      });

      if (!storedToken) {
        this.logger.warn('Refresh token not found in database');
        throw new UnauthorizedException('Invalid refresh token');
      }

      // If legacy plaintext stored, upgrade to hashed for future lookups
      if (storedToken.token === refreshToken) {
        await this.prismaService.refreshToken.update({
          where: { token: refreshToken },
          data: { token: hashedToken },
        });
      }

      if (new Date() > storedToken.expiresAt) {
        this.logger.warn('Refresh token expired');
        // Delete expired token
        await this.prismaService.refreshToken.deleteMany({
          where: { token: { in: [refreshToken, hashedToken] } },
        });
        throw new UnauthorizedException('Refresh token expired');
      }

      const payload = this.jwtService.verify(refreshToken, {
        secret: refreshSecret,
      });

      // Verify user/customer exists
      let principal: any = null;
      if (payload.type === 'customer') {
        principal = await this.prismaService.customer.findUnique({
          where: { id: payload.sub },
        });
      } else {
        principal = await this.prismaService.user.findUnique({
          where: { id: payload.sub },
        });
      }

      if (!principal) {
        throw new UnauthorizedException('Principal not found');
      }

      // SECURITY FIX: Delete old refresh token (rotation)
      await this.prismaService.refreshToken.deleteMany({
        where: { token: { in: [refreshToken, hashedToken] } },
      });

      // Log token refresh
      await this.logAuditEvent(
        principal.id,
        principal.tenantId,
        'TOKEN_REFRESHED',
        principal.id,
        payload.type === 'customer' ? 'customer' : 'user'
      );

      // Generate new tokens
      return this.generateTokens(principal, payload.type === 'customer');
    } catch (error) {
      await this.logSecurityEvent(
        'INVALID_REFRESH_TOKEN',
        'MEDIUM',
        undefined,
        undefined,
        undefined,
        undefined,
        `Invalid refresh token attempt: ${error}`
      );
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto, ipAddress?: string, tenantId?: string): Promise<{ message: string; previewUrl?: string; code?: string }> {
    let { email } = forgotPasswordDto;
    
    // Normalize email
    if (email) {
      email = email.toLowerCase().trim();
    }
    
    const safeIpAddress = ipAddress || 'unknown';

    // Check rate limiting for password reset
    const passwordResetConfig = this.rateLimitingService.getPasswordResetConfig();
    const rateLimitCheck = await this.rateLimitingService.checkRateLimit(
      email,
      'PASSWORD_RESET',
      passwordResetConfig.maxAttempts,
      passwordResetConfig.windowMs
    );

    if (!rateLimitCheck.allowed) {
      throw new ForbiddenException(`Too many password reset attempts. Please try again after ${Math.ceil((rateLimitCheck.resetTime.getTime() - Date.now()) / 60000)} minutes.`);
    }

    this.logger.log(`🔧 Forgot password request for: ${email}, tenantId: ${tenantId || 'none'} from IP: ${safeIpAddress}`);

    // Check if user exists (Admins/Owners are global)
    const user = await this.prismaService.user.findUnique({
      where: { email },
    });

    // Check if customer exists if user doesn't. STRICT: Must match tenantId if provided.
    let customer = null;
    if (!user) {
      const customerWhere: any = { email };
      if (tenantId) {
        // Resolve tenantId if it's a subdomain
        let resolvedTenantId = tenantId;
        const tenant = await this.prismaService.tenant.findFirst({
          where: {
            OR: [
              { id: tenantId },
              { subdomain: tenantId }
            ]
          }
        });
        if (tenant) resolvedTenantId = tenant.id;
        customerWhere.tenantId = resolvedTenantId;
      }

      customer = await this.prismaService.customer.findFirst({
        where: customerWhere,
      });
    }

    // Don't reveal whether user/customer exists for security
    const response: any = { 
      message: 'If the email exists, a reset code has been sent',
    };

    if (!user && !customer) {
      await this.logSecurityEvent(
        'PASSWORD_RESET_ATTEMPT',
        'LOW',
        undefined,
        undefined,
        safeIpAddress,
        undefined,
        `Password reset attempt for non-existent email: ${email}`
      );
      return response;
    }

    // SECURITY FIX: Generate cryptographically secure reset token (already using crypto.randomBytes(32))
    const resetToken = this.generateResetToken();
    const resetCode = `RESET_${resetToken}`;
    
    // SECURITY FIX: Set shorter expiration (15 minutes) for better security
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Store reset token in database with RESET_ prefix
    try {
      // Delete any existing unused reset tokens for this email
      await this.prismaService.passwordReset.deleteMany({
        where: {
          email,
          used: false,
          code: { startsWith: 'RESET_' },
        },
      });

      await this.prismaService.passwordReset.create({
        data: {
          email,
          code: resetCode,
          expiresAt,
        },
      });

      // Log password reset request
      if (user) {
        await this.logAuditEvent(
          user.id,
          user.tenantId,
          'PASSWORD_RESET_REQUESTED',
          user.id,
          'user',
          undefined,
          undefined,
          { ipAddress: safeIpAddress }
        );
      } else if (customer) {
        this.logger.log(`✅ Password reset requested for customer: ${email}`);
        // Customers don't have audit logs in the same way yet, but we can log to console
      }

      this.logger.log(`✅ Password reset token stored for: ${email}`);
    } catch (error) {
      this.logger.error('❌ Failed to store password reset token:', error);
      throw new Error('Failed to process password reset request');
    }

    // Send password reset link email
    try {
      // Use tenantId ONLY for customers (Store Branding)
      // For users (Merchants/Admins), leave undefined to use Platform Branding (Koun)
      const targetTenantId = customer ? (customer as any).tenantId : undefined;
      const emailResult = await this.emailService.sendPasswordResetLinkEmail(email, resetToken, targetTenantId);
      
      response.message = 'If the email exists, a password reset link has been sent to your email';
      
      // In development, return preview URL
      if (process.env.NODE_ENV === 'development' && emailResult.previewUrl) {
        response.previewUrl = emailResult.previewUrl;
      }

      return response;
    } catch (emailError) {
      this.logger.error('❌ Email sending failed:', emailError);
      throw new Error('Failed to send password reset email');
    }
  }

  async verifyResetToken(token: string): Promise<{ valid: boolean; message: string; email?: string }> {
    // Verify reset token
    const resetCode = `RESET_${token}`;
    const resetRecord = await this.prismaService.passwordReset.findFirst({
      where: {
        code: resetCode,
        used: false,
        expiresAt: {
          gt: new Date(), // Not expired
        },
      },
    });

    if (!resetRecord) {
      return { valid: false, message: 'Invalid or expired reset link' };
    }

    return { 
      valid: true, 
      message: 'Reset link is valid',
      email: resetRecord.email 
    };
  }

  async verifyResetCode(email: string, code: string): Promise<{ valid: boolean; message: string }> {
    // Check if user exists
    const existingUser = await this.prismaService.user.findUnique({
      where: { email },
    });

    if (!existingUser) {
      // Don't reveal if user exists
      return { valid: false, message: 'Invalid or expired verification code' };
    }

    // Verify OTP code with RESET_ prefix
    const resetCode = `RESET_${code}`;
    const resetRecord = await this.prismaService.passwordReset.findFirst({
      where: {
        email,
        code: resetCode,
        used: false,
        expiresAt: {
          gt: new Date(), // Not expired
        },
      },
    });

    if (!resetRecord) {
      await this.logSecurityEvent(
        'INVALID_RESET_CODE',
        'LOW',
        existingUser.id,
        existingUser.tenantId,
        undefined,
        undefined,
        `Invalid password reset OTP attempt for email: ${email}`
      );
      return { valid: false, message: 'Invalid or expired verification code' };
    }

    return { valid: true, message: 'Verification code is valid' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto, ipAddress?: string): Promise<{ message: string }> {
    try {
      const { email, code, token, newPassword } = resetPasswordDto as any;
      const safeIpAddress = ipAddress || 'unknown';

      // SECURITY FIX: Validate password against policy
      validatePasswordOrThrow(newPassword, undefined, email ? { email } : undefined);

      let resetRecord;
      let userEmail: string;

      // Support both token-based (new) and code-based (legacy) reset
  if (token) {
    // Token-based reset (new method)
    const resetCode = `RESET_${token}`;
    resetRecord = await this.prismaService.passwordReset.findFirst({
      where: {
        code: resetCode,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    userEmail = resetRecord.email;
  } else if (email && code) {
    // Code-based reset (legacy method)
    const existingUser = await this.prismaService.user.findUnique({
      where: { email },
    });

    const existingCustomer = !existingUser ? await this.prismaService.customer.findFirst({
      where: { email },
    }) : null;

    if (!existingUser && !existingCustomer) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const resetCode = `RESET_${code}`;
    resetRecord = await this.prismaService.passwordReset.findFirst({
      where: {
        email,
        code: resetCode,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!resetRecord) {
      if (existingUser) {
        await this.logSecurityEvent(
          'INVALID_RESET_CODE',
          'MEDIUM',
          existingUser.id,
          existingUser.tenantId,
          safeIpAddress,
          undefined,
          `Invalid password reset attempt for email: ${email}`
        );
      }
      throw new BadRequestException('Invalid or expired verification code');
    }

    userEmail = email;
  } else {
    throw new BadRequestException('Token or email and code are required');
  }

  // Get user or customer
  const existingUser = await this.prismaService.user.findUnique({
    where: { email: userEmail },
  });

  const existingCustomer = !existingUser ? await this.prismaService.customer.findFirst({
    where: { email: userEmail },
  }) : null;

  if (!existingUser && !existingCustomer) {
    throw new BadRequestException('Invalid or expired reset link');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password and mark reset code as used in a transaction
  await this.prismaService.$transaction(async (tx: Prisma.TransactionClient) => {
      if (existingUser) {
        // Update user password
        await tx.user.update({
          where: { email: userEmail },
          data: { password: hashedPassword },
        });
      } else if (existingCustomer) {
        // Update customer password in both the dedicated column and metadata (for compatibility)
        let metadata: any = {};
        try {
          metadata = existingCustomer.metadata ? JSON.parse(existingCustomer.metadata as string) : {};
        } catch (e) {
          metadata = {};
        }
        metadata.password = hashedPassword;

        await tx.customer.update({
          where: { id: existingCustomer.id },
          data: { 
            password: hashedPassword,
            metadata: JSON.stringify(metadata)
          } as any,
        });
      }

      // Mark reset code as used
      await tx.passwordReset.update({
        where: { id: resetRecord.id },
        data: { used: true },
      });

      // Delete all other reset codes for this email
      await tx.passwordReset.deleteMany({
        where: {
          email: userEmail,
          used: false,
        },
      });
    });

    // Log security event
    if (existingUser) {
      await this.logSecurityEvent(
        'PASSWORD_RESET',
        'LOW',
        existingUser.id,
        existingUser.tenantId,
        safeIpAddress,
        undefined,
        `Password reset successful for user: ${userEmail}`
      );
    } else {
      this.logger.log(`✅ Password reset successful for customer: ${userEmail}`);
    }

    this.logger.log(`✅ Password reset successful for: ${userEmail}`);
    return { message: 'Password reset successfully' };
    } catch (error: any) {
      this.logger.error(`❌ Password reset failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Change password for authenticated users (used for first login and regular password changes)
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    try {
      // Get user
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Verify current password (if mustChangePassword is false, require current password)
      // If mustChangePassword is true, allow change without current password (first login)
      if (!user.mustChangePassword) {
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
          throw new BadRequestException('Current password is incorrect');
        }
      } else {
        // For first login, verify the temporary password
        const isTemporaryPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isTemporaryPasswordValid) {
          throw new BadRequestException('Temporary password is incorrect');
        }
      }

      // SECURITY FIX: Validate password against policy
      validatePasswordOrThrow(newPassword, undefined, { email: user.email, username: user.username });

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password and clear mustChangePassword flag
      await this.prismaService.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          mustChangePassword: false, // Clear the flag after password change
        },
      });

      this.logger.log(`✅ Password changed successfully for user: ${user.email}`);
      return { message: 'Password changed successfully' };
    } catch (error: any) {
      this.logger.error(`❌ Password change failed: ${error.message}`);
      throw error;
    }
  }

  async createStaffUser(tenantId: string, creatingUserId: string, staffData: { email: string; password: string; permissions: string[] }) {
    // Verify creating user has permission to create staff
    const creatingUser = await this.prismaService.user.findFirst({
      where: { 
        id: creatingUserId,
        tenantId,
        role: { in: ['SUPER_ADMIN', 'SHOP_OWNER'] }
      },
    });

    if (!creatingUser) {
      throw new ForbiddenException('Insufficient permissions to create staff users');
    }

    // Check if user already exists
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: staffData.email },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(staffData.password, 12);

    // Create staff user and permissions in transaction
    const result = await this.prismaService.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create user as staff
      const user = await tx.user.create({
        data: {
          email: staffData.email,
          password: hashedPassword,
          role: 'STAFF',
          tenantId,
        },
      });

      // Create staff permissions
      const permissions = await Promise.all(
        staffData.permissions.map(permission =>
          tx.staffPermission.create({
            data: {
              userId: user.id,
              tenantId,
              permission,
              grantedBy: creatingUserId,
            },
          })
        )
      );

      return { user, permissions };
    });

    // Log staff creation
    await this.logAuditEvent(
      creatingUserId,
      tenantId,
      'STAFF_CREATED',
      result.user.id,
      'user',
      undefined,
      { permissions: staffData.permissions },
      { staffEmail: staffData.email }
    );

    this.logger.log(`✅ Staff user created: ${staffData.email} by user: ${creatingUserId}`);

    return result;
  }

  async getUserPermissions(userId: string, tenantId: string): Promise<string[]> {
    const permissions = await this.prismaService.staffPermission.findMany({
      where: {
        userId,
        tenantId,
      },
      select: { permission: true },
    });

    return permissions.map((p: { permission: any; }) => p.permission);
  }

  async checkPermission(userId: string, tenantId: string, permission: string): Promise<boolean> {
    const user = await this.prismaService.user.findFirst({
      where: { id: userId, tenantId },
    });

    if (!user) {
      return false;
    }

    // Super admins and shop owners have all permissions
    if (user.role === 'SUPER_ADMIN' || user.role === 'SHOP_OWNER') {
      return true;
    }

    // Check specific permission for staff
    const hasPermission = await this.prismaService.staffPermission.findFirst({
      where: {
        userId,
        tenantId,
        permission,
      },
    });

    return !!hasPermission;
  }

  async getStaffUsers(tenantId: string) {
    return this.prismaService.user.findMany({
      where: {
        tenantId,
        role: 'STAFF',
      },
      include: {
        staffPermissions: {
          select: {
            permission: true,
            grantedAt: true,
            grantedBy: true,
          },
        },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        staffPermissions: true,
      },
    });
  }

  async updateStaffPermissions(tenantId: string, updatingUserId: string, staffUserId: string, permissions: string[]) {
    // Verify updating user has permission
    const updatingUser = await this.prismaService.user.findFirst({
      where: { 
        id: updatingUserId,
        tenantId,
        role: { in: ['SUPER_ADMIN', 'SHOP_OWNER'] }
      },
    });

    if (!updatingUser) {
      throw new ForbiddenException('Insufficient permissions to update staff permissions');
    }

    // Verify staff user exists and belongs to tenant
    const staffUser = await this.prismaService.user.findFirst({
      where: { 
        id: staffUserId,
        tenantId,
        role: 'STAFF'
      },
    });

    if (!staffUser) {
      throw new NotFoundException('Staff user not found');
    }

    // Update permissions in transaction
    const result = await this.prismaService.$transaction(async (tx: Prisma.TransactionClient) => {
      // Remove existing permissions
      await tx.staffPermission.deleteMany({
        where: {
          userId: staffUserId,
          tenantId,
        },
      });

      // Create new permissions
      const newPermissions = await Promise.all(
        permissions.map(permission =>
          tx.staffPermission.create({
            data: {
              userId: staffUserId,
              tenantId,
              permission,
              grantedBy: updatingUserId,
            },
          })
        )
      );

      return newPermissions;
    });

    // Log permission update
    await this.logAuditEvent(
      updatingUserId,
      tenantId,
      'STAFF_PERMISSIONS_UPDATED',
      staffUserId,
      'user',
      undefined,
      { permissions },
      { staffEmail: staffUser.email }
    );

    this.logger.log(`✅ Staff permissions updated for user: ${staffUser.email} by user: ${updatingUserId}`);

    return result;
  }

  async generateTokens(user: any, isCustomer: boolean = false) {
    // Ensure we have the latest tenantId from the database
    // This handles cases where tenantId was updated after user object was loaded
    let tenantId = user.tenantId;
    
    // If tenantId is missing, try to get it from user_tenants table
    if (!tenantId && !isCustomer) {
      try {
        const userTenant = await this.prismaService.userTenant.findFirst({
          where: { userId: user.id, isOwner: true },
          orderBy: { createdAt: 'desc' }
        });
        if (userTenant) {
          tenantId = userTenant.tenantId;
          this.logger.log(`Retrieved tenantId ${tenantId} from user_tenants for user ${user.id}`);
        }
      } catch (error) {
        this.logger.warn(`Could not retrieve tenantId from user_tenants for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    const payload = { 
      sub: user.id, 
      email: user.email, 
      role: user.role, 
      tenantId: tenantId || null,
      type: isCustomer ? 'customer' : 'user'
    };

    // Log token generation for debugging
    if (!tenantId && !isCustomer && user.role !== 'SUPER_ADMIN') {
      this.logger.warn(`Generating JWT token without tenantId for user ${user.id} (${user.email}). User may need to set up a market.`);
    } else {
      this.logger.debug(`Generating JWT token for ${isCustomer ? 'customer' : 'user'} ${user.id} with tenantId: ${tenantId}`);
    }

    const accessToken = this.jwtService.sign(payload);
    
    // Generate unique refresh token
    const refreshTokenPayload = {
      ...payload,
      jti: crypto.randomBytes(16).toString('hex'), // Unique ID
      type: 'refresh'
    };
    
    // SECURITY FIX: Require JWT_REFRESH_SECRET (no fallback)
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!refreshSecret) {
      this.logger.error('JWT_REFRESH_SECRET is required');
      throw new Error('JWT refresh secret is not configured');
    }
    
    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      secret: refreshSecret,
      expiresIn: '7d',
    });

    // Store refresh token in database
    await this.storeRefreshToken(user.id, refreshToken, isCustomer);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(id: string, token: string, isCustomer: boolean = false) {
    try {
      const tokenHash = this.hashToken(token);
      await this.prismaService.refreshToken.upsert({
        where: { token: tokenHash },
        create: {
          token: tokenHash,
          userId: isCustomer ? null : id,
          customerId: isCustomer ? id : null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
        update: {
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      this.logger.error('Failed to store refresh token:', error);
      // Don't throw, just log. Login should still succeed with access token.
    }
  }

  // SECURITY FIX: Invalidate refresh token on logout
  async invalidateRefreshToken(token: string, userId: string): Promise<void> {
    try {
      const tokenHash = this.hashToken(token);
      await this.prismaService.refreshToken.deleteMany({
        where: {
          token: { in: [token, tokenHash] },
          userId,
        },
      });
      this.logger.log(`Refresh token invalidated for user: ${userId}`);
    } catch (error) {
      this.logger.error('Failed to invalidate refresh token:', error);
      throw error;
    }
  }

  private generateResetCode(): string {
    // Generate 6-digit numeric code using crypto (better entropy)
    // crypto.randomInt max is exclusive, so 1,000,000 means max 999,999
    return crypto.randomInt(100000, 1000000).toString();
  }

  private generateResetToken(): string {
    // Generate secure random token for password reset link
    return crypto.randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async checkDeviceFingerprint(fingerprint: any, identifier: string, ip: string, userAgent?: string) {
    this.logger.log(`🔍 Checking device fingerprint for ${identifier}. Fingerprint data present: ${!!fingerprint}, IP: ${ip}`);
    
    // Server-side IP reputation check (more reliable than client-side)
    const ipCheck = await checkIpReputation(ip);
    const isVpnFromIp = ipCheck.isVpn || ipCheck.isProxy || ipCheck.isTor;
    
    if (isVpnFromIp) {
      this.logger.warn(`🔴 VPN/Proxy detected via IP check for ${identifier}: IP=${ip}, ISP=${ipCheck.isp}, Country=${ipCheck.country}`);
    }
    
    // Use fingerprint data if available, but prefer IP check for VPN
    const { visitorId, isVM, isVpn: isVpnFromClient, os, components, riskScore } = fingerprint || {};
    const isVpn = isVpnFromIp || isVpnFromClient; // Either detection method
    const blockVpnLogins = (process.env.BLOCK_VPN_LOGINS || '').toLowerCase() === 'true';
    
    let relatedEmails: string[] = [];
    let userId: string | undefined;
    let tenantId: string | undefined;
    let email = identifier.includes('@') ? identifier : undefined;

    // Block VPN/proxy if enforced
    if (blockVpnLogins && isVpn) {
      this.logger.warn(`❌ VPN/Proxy login blocked for ${identifier}: IP=${ip}, ISP=${ipCheck?.isp}, Country=${ipCheck?.country}`);
      throw new UnauthorizedException('VPN/proxy logins are not allowed.');
    }

    // Find user to associate event and check tenant settings
    try {
        // Try to find user by email or username
        let user = null;
        if (email) {
            user = await this.prismaService.user.findUnique({
                where: { email },
                select: { 
                    id: true, 
                    email: true,
                    tenantId: true,
                    role: true,
                    username: true,
                    tenant: {
                        select: { id: true, subdomain: true }
                    }
                }
            });
        } else {
            user = await this.prismaService.user.findFirst({
                where: { username: identifier.toLowerCase() },
                select: { 
                    id: true, 
                    email: true,
                    tenantId: true,
                    role: true,
                    username: true,
                    tenant: {
                        select: { id: true, subdomain: true }
                    }
                }
            });
            if (user) {
                email = user.email;
            }
        }

        if (user) {
            userId = user.id;
            tenantId = user.tenantId || undefined;

            // SUPER_ADMIN bypass VPN check
            if (user.role === 'SUPER_ADMIN') {
              this.logger.log(`Bypassing VPN check for SUPER_ADMIN: ${email}`);
            } else if (isVpn) {
              // Automatic VPN blocking - Enforce security without user setting
              this.logger.warn(`Blocking login for ${email} due to VPN detection.`);
              throw new ForbiddenException('Access denied: VPN/Proxy usage is not allowed. Please disable your VPN and try again.');
            }
        } else if (isVpn) {
          // No user found but VPN detected - still block for new signups
          this.logger.warn(`Blocking signup/login attempt for ${identifier} due to VPN detection (no user found).`);
          throw new ForbiddenException('Access denied: VPN/Proxy usage is not allowed. Please disable your VPN and try again.');
        }
    } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        this.logger.warn(`Could not find user for fingerprint logging: ${identifier}`);
    }

    // Check device history for other accounts
    try {
        // Fetch recent DEVICE_FINGERPRINT events and filter in code (MySQL doesn't support JSON path queries like PostgreSQL)
        const recentEvents = await this.prismaService.securityEvent.findMany({
            where: {
                type: 'DEVICE_FINGERPRINT',
            },
            select: {
                metadata: true
            },
            take: 500,
            orderBy: { createdAt: 'desc' }
        });

        const emailSet = new Set<string>();
        if (email) emailSet.add(email);

        for (const event of recentEvents) {
            try {
                const meta: any = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
                // Filter by visitorId in code
                if (meta && meta.fingerprint && meta.fingerprint.visitorId === visitorId && meta.email) {
                    emailSet.add(meta.email);
                }
            } catch {
                // Skip invalid JSON
            }
        }
        relatedEmails = Array.from(emailSet);

    } catch (e) {
        this.logger.error('Error checking device history', e);
    }

    // Log the fingerprint event with related emails
    await this.logSecurityEvent(
      'DEVICE_FINGERPRINT',
      'LOW',
      userId,
      tenantId,
      ip,
      userAgent,
      `Device fingerprint collected for ${email || identifier}`,
      { fingerprint, email: email || identifier, relatedEmails, isVpn, os }
    );

    // 1. VM Detection
    if (isVM) {
      await this.logSecurityEvent(
        'VM_DETECTED',
        'MEDIUM',
        userId,
        tenantId,
        ip,
        userAgent,
        `Virtual Machine detected during auth for ${email || identifier}`,
        { fingerprint, email: email || identifier }
      );
    }

    // 2. High Risk Score
    if (riskScore > 70) {
       await this.logSecurityEvent(
        'HIGH_RISK_DEVICE',
        'HIGH',
        userId,
        tenantId,
        ip,
        userAgent,
        `High risk device detected (Score: ${riskScore}) for ${email || identifier}`,
        { fingerprint, email: email || identifier }
      );
    }

    // 3. Multiple Accounts Check
    if (relatedEmails.length > 3) {
            await this.logSecurityEvent(
            'MULTIPLE_ACCOUNTS_ON_DEVICE',
            'CRITICAL',
            userId,
            tenantId,
            ip,
            userAgent,
            `Device used by ${relatedEmails.length} different emails: ${relatedEmails.join(', ')}`,
            { fingerprint, emails: relatedEmails }
        );
    }
  }

  private async logAuditEvent(
    userId: string,
    tenantId: string | null | undefined,
    action: string,
    resourceId?: string,
    resourceType?: string,
    oldValues?: any,
    newValues?: any,
    metadata?: any,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
  try {
    // Sanitize sensitive fields before logging
    const sanitize = (obj: any) => {
      if (!obj) return null;
      const sanitized = { ...obj };
      ['password', 'token', 'secret', 'key'].forEach(field => {
        if (field in sanitized) sanitized[field] = '[REDACTED]';
      });
      return JSON.stringify(sanitized);
    };

    await this.prismaService.auditLog.create({
      data: {
        userId,
        tenantId: tenantId || undefined,
        action,
        resourceId,
        resourceType,
        oldValues: sanitize(oldValues), 
        newValues: sanitize(newValues),
        metadata: metadata ? JSON.stringify(metadata) : null,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    this.logger.error('Failed to log audit event:', error);
  }
  }

  private async logSecurityEvent(
    type: string,
    severity: string,
    userId?: string,
    tenantId?: string,
    ipAddress?: string,
    userAgent?: string,
    description?: string,
    metadata?: any,
  ): Promise<void> {
    try {
      // Get geolocation data
      let geoData: any = {};
      if (ipAddress && ipAddress !== 'unknown') {
        try {
          const { checkIpReputation } = await import('../../utils/ip-checker');
          const ipInfo = await checkIpReputation(ipAddress);
          geoData = {
            country: ipInfo.country,
            countryCode: ipInfo.countryCode,
            city: ipInfo.city,
            region: ipInfo.region,
            latitude: ipInfo.latitude,
            longitude: ipInfo.longitude,
            isp: ipInfo.isp,
            isVpn: ipInfo.isVpn,
            isProxy: ipInfo.isProxy,
          };
        } catch (geoError) {
          this.logger.warn('Failed to get geolocation for IP:', geoError);
        }
      }

      // Parse user agent to get OS, browser, device
      let deviceInfo = { os: 'Unknown', browser: 'Unknown', device: 'Unknown' };
      if (userAgent) {
        try {
          const { parseUserAgent } = await import('../../utils/user-agent-parser');
          deviceInfo = parseUserAgent(userAgent);
        } catch (parseError) {
          this.logger.warn('Failed to parse user agent:', parseError);
        }
      }

      await this.prismaService.securityEvent.create({
        data: {
          type,
          severity,
          userId: userId || undefined,
          tenantId: tenantId || undefined,
          ipAddress: ipAddress || undefined,
          userAgent: userAgent || undefined,
          description: description || `Security event: ${type}`,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
          // Geolocation fields
          country: geoData.country,
          countryCode: geoData.countryCode,
          city: geoData.city,
          region: geoData.region,
          latitude: geoData.latitude,
          longitude: geoData.longitude,
          isp: geoData.isp,
          isVpn: geoData.isVpn || false,
          isProxy: geoData.isProxy || false,
          // Device info fields
          os: deviceInfo.os,
          browser: deviceInfo.browser,
          device: deviceInfo.device,
        },
      });

      this.logger.log(`📋 Security event logged: ${type} (severity: ${severity}) - IP: ${ipAddress} - OS: ${deviceInfo.os} - Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
    } catch (error) {
      this.logger.error('Failed to log security event:', error);
      if (error instanceof Error) {
        this.logger.error(error.stack);
      }
    }
  }

  // Removed duplicate createTestSecurityEvent - using the one at line 39

  async validateUser(payload: any) {
    // 1. Try to find in User table (Platform Users: Shop Owners, Staff)
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });

    if (user) {
      return user;
    }

    // 2. Try to find in Customer table (Store Customers)
    const customer = await this.prismaService.customer.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });

    if (customer) {
      return {
        ...customer,
        role: 'CUSTOMER', // Standardize role for customers
        name: customer.firstName ? `${customer.firstName} ${customer.lastName || ''}`.trim() : null,
      };
    }

    // 3. Try to find in CustomerEmployee table
    const employee = await this.prismaService.customerEmployee.findUnique({
      where: { id: payload.sub },
      include: { customer: { include: { tenant: true } } },
    });

    if (employee) {
      return {
        ...employee,
        role: 'CUSTOMER_EMPLOYEE',
        tenantId: employee.customer.tenantId,
        tenant: employee.customer.tenant,
        // Map isActive to !isDisabled for JwtStrategy check
        isDisabled: !employee.isActive,
      };
    }

    return null;
  }

  async getAuditLogs(filters: { tenantId?: string; page?: number; limit?: number }, callerRole?: string, callerTenantId?: string) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    // SECURITY FIX: Enforce tenant isolation
    if (callerRole === 'SUPER_ADMIN') {
        // Admin can filter by specific tenant or view all
        if (filters?.tenantId) where.tenantId = filters.tenantId;
    } else {
        // Non-admin users can ONLY see their own tenant's logs
        if (!callerTenantId) {
            // Should be caught by controller, but safe fallback
            this.logger.warn('getAuditLogs called without tenant context for non-admin');
            throw new ForbiddenException('Access denied: Tenant context required');
        }
        where.tenantId = callerTenantId;
    }

    const [logs, total] = await Promise.all([
      this.prismaService.auditLog.findMany({
        where,
        include: {
          user: {
            select: { email: true, name: true },
          },
          tenant: {
            select: { name: true, subdomain: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.auditLog.count({ where }),
    ]);

      // Format logs to match frontend expectations
      const formattedLogs = logs.map((log: any) => ({
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      details: `${log.action} on ${log.resourceType || 'system'}`,
      createdAt: log.createdAt,
      user: { email: log.user?.email || 'System', name: log.user?.name },
      tenant: log.tenant,
      oldValues: log.oldValues,
      newValues: log.newValues,
      metadata: log.metadata,
    }));

    return {
      logs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async logErrorEvent(params: {
    message: string;
    stack?: string;
    userId?: string;
    tenantId?: string;
    context?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    metadata?: Record<string, any>;
  }) {
    const { message, stack, userId, tenantId, context, severity = 'HIGH', metadata = {} } = params;
    try {
      await this.prismaService.auditLog.create({
        data: {
          userId: userId || undefined,
          tenantId: tenantId || undefined,
          action: 'ERROR',
          resourceType: context || 'SYSTEM',
          resourceId: severity,
          oldValues: null,
          newValues: null,
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
          metadata: JSON.stringify({
            severity,
            message,
            stack,
            ...metadata,
          }),
        },
      });
    } catch (error) {
      this.logger.error('Failed to log error event:', error);
    }
  }

  async getErrorLogs(filters?: { tenantId?: string; page?: number; limit?: number }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      action: 'ERROR',
    };
    if (filters?.tenantId) where.tenantId = filters.tenantId;

    const [logs, total] = await Promise.all([
      this.prismaService.auditLog.findMany({
        where,
        include: {
          user: { select: { email: true, name: true } },
          tenant: { select: { name: true, subdomain: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.auditLog.count({ where }),
    ]);

      const formattedLogs = logs.map((log: any) => {
      let meta: any = log.metadata;
      if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
      }
      return {
        id: log.id,
        action: 'ERROR',
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        severity: meta?.severity || 'HIGH',
        details: meta?.message || log.metadata || 'System error',
        createdAt: log.createdAt,
        user: { email: log.user?.email || 'System', name: log.user?.name },
        tenant: log.tenant,
        metadata: meta,
      };
    });

    return {
      logs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSecurityEvents(filters?: { tenantId?: string; page?: number; limit?: number }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.tenantId) where.tenantId = filters.tenantId;

    const [events, total] = await Promise.all([
      this.prismaService.securityEvent.findMany({
        where,
        include: {
          user: {
            select: { email: true },
          },
          tenant: {
            select: { name: true, subdomain: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.securityEvent.count({ where }),
    ]);

    // Format events to match frontend expectations
    const formattedLogs = events.map((log: any) => {
      let metadata: any = log.metadata;
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
      }
      return {
        id: log.id,
        action: log.type,
        details: log.description,
        ipAddress: log.ipAddress || '-',
        severity: log.severity,
        createdAt: log.createdAt,
        user: { email: log.user?.email || 'System' },
        tenant: log.tenant,
        metadata: {
          ...metadata,
          country: log.country,
          city: log.city,
          isVpn: log.isVpn,
          isp: log.isp,
          os: log.os,
          browser: log.browser,
          device: log.device,
        },
      };
    });

    return {
      logs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

// Add to your existing AuthService in auth.service.ts

async validateOrCreateUserFromOAuth(oauthUser: {
  email: string;
  firstName: string;
  lastName: string;
  picture?: string;
}) {
  this.logger.log('🔧 Processing OAuth user:', oauthUser.email);

  // Check if user exists
  let user = await this.prismaService.user.findFirst({
    where: { email: oauthUser.email },
    include: { tenant: true },
  });

  if (user) {
    this.logger.log('✅ Existing user found, generating tokens');
    
    const tokens = await this.generateTokens(user);
    
    await this.logAuditEvent(
      user.id,
      user.tenantId,
      'USER_LOGIN_OAUTH',
      user.id,
      'user',
      undefined,
      undefined,
      { loginMethod: 'google_oauth' }
    );

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      ...tokens,
    };
  }

  this.logger.log('🆕 Creating new user from OAuth');

  const tempSubdomain = `temp-${Date.now()}`;
  
    const result = await this.prismaService.$transaction(async (tx: Prisma.TransactionClient) => {
    // ✅ FIX: Use 'ACTIVE' status which exists in your enum
    const tenant = await tx.tenant.create({
      data: {
        name: `${oauthUser.firstName} ${oauthUser.lastName}'s Store`,
        subdomain: tempSubdomain,
        plan: 'STARTER',
        status: 'ACTIVE', // This is valid in your Status enum
      },
    });

    const user = await tx.user.create({
      data: {
        email: oauthUser.email,
        password: '',
        role: 'SHOP_OWNER',
        tenantId: tenant.id,
        oauthProvider: 'GOOGLE',
        emailVerified: true,
        avatar: oauthUser.picture,
        setupCompleted: false,
      },
    });

    return { user, tenant };
  });

  const tokens = await this.generateTokens(result.user);

  await this.logAuditEvent(
    result.user.id,
    result.tenant.id,
    'USER_REGISTERED_OAUTH',
    result.user.id,
    'user',
    undefined,
    { 
      role: 'SHOP_OWNER', 
      subdomain: tempSubdomain,
      oauthProvider: 'GOOGLE'
    },
    { registrationMethod: 'google_oauth', setupPending: true }
  );

  this.logger.log('✅ New OAuth user created:', result.user.email);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    tenantId: result.tenant.id,
    setupPending: true, // We'll still track this in the response
    ...tokens,
  };
}

async completeOAuthSetup(
  userId: string,
  setupData: {
    storeName: string;
    subdomain: string;
  }
) {
  this.logger.log('Completing OAuth setup for user: ' + userId);
  
  const user = await this.prismaService.user.findUnique({
    where: { id: userId },
    include: { tenant: true },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Check if subdomain is available
  const existingTenant = await this.prismaService.tenant.findUnique({
    where: { subdomain: setupData.subdomain },
  });

  if (existingTenant && existingTenant.id !== user.tenantId) {
    throw new ConflictException('Subdomain already taken');
  }

  // Update tenant with real business info
  const updatedTenant = await this.prismaService.tenant.update({
    where: { id: user.tenantId },
    data: {
      name: setupData.storeName,
      subdomain: setupData.subdomain,
      status: 'ACTIVE',
    },
  });

  // Log setup completion
  await this.logAuditEvent(
    userId,
    user.tenantId,
    'OAUTH_SETUP_COMPLETED',
    userId,
    'user',
    undefined,
    { storeName: setupData.storeName, subdomain: setupData.subdomain }
  );

  this.logger.log('OAuth setup completed for user: ' + userId);

  return {
    message: 'Setup completed successfully',
    tenant: updatedTenant,
  };
}


  // Helper method to safely handle IP addresses
  private getSafeIpAddress(ipAddress: string | undefined): string {
    return ipAddress || 'unknown';
  }

  // ==================== MARKET MANAGEMENT ====================

  /**
   * Get all markets (tenants) for a user
   */
  async getUserMarkets(userId: string) {
    try {
      if (!userId) {
        throw new UnauthorizedException('User ID is required');
      }

      // Get user's current active tenant
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });

      const userTenants = await this.prismaService.userTenant.findMany({
        where: { userId },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              subdomain: true,
              plan: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Verify that all returned tenants are actually linked to this user
      const verifiedUserTenants = userTenants.filter((ut: any) => {
        if (ut.userId !== userId) {
          this.logger.warn(`⚠️ Found tenant ${ut.tenant.id} linked to wrong user. Expected ${userId}, found ${ut.userId}`);
          return false;
        }
        return true;
      });

      return verifiedUserTenants.map((ut: any) => ({
        id: ut.tenant.id,
        name: ut.tenant.name,
        subdomain: ut.tenant.subdomain,
        plan: ut.tenant.plan,
        status: ut.tenant.status,
        createdAt: ut.tenant.createdAt,
        isOwner: ut.isOwner,
        isActive: ut.tenant.id === user?.tenantId,
      }));
    } catch (error) {
      this.logger.error('Error in getUserMarkets:', error);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to fetch user markets');
    }
  }

  /**
   * Check if user can create a new market (check limit)
   */
  async canCreateMarket(userId: string): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
    try {
      if (!userId) {
        throw new UnauthorizedException('User ID is required');
      }

      // Handle system-admin (Admin API Key requests)
      if (userId === 'system-admin') {
        return {
          allowed: true,
          currentCount: 0,
          limit: 999,
        };
      }

      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        select: { marketLimit: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Ensure marketLimit is at least 2 (default)
      const marketLimit = user.marketLimit || 2;

      const currentCount = await this.prismaService.userTenant.count({
        where: { userId, isOwner: true },
      });

      // User can create a market if currentCount is strictly less than the limit
      // This ensures if limit is 1, user can create 1 market (when currentCount is 0)
      const allowed = currentCount < marketLimit;

      return {
        allowed,
        currentCount,
        limit: marketLimit,
      };
    } catch (error) {
      this.logger.error('Error in canCreateMarket:', error);
      if (error instanceof UnauthorizedException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to check market creation limit');
    }
  }

  /**
   * Create UserTenant relationship (link user to tenant)
   */
  async linkUserToTenant(userId: string, tenantId: string, isOwner: boolean = true) {
    // Check if relationship already exists
    const existing = await this.prismaService.userTenant.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prismaService.userTenant.create({
      data: {
        userId,
        tenantId,
        isOwner,
      },
    });
  }

  /**
   * Switch user's active tenant
   */
  async switchActiveTenant(userId: string, tenantId: string) {
    // Verify user has access to this tenant
    const userTenant = await this.prismaService.userTenant.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
    });

    if (!userTenant) {
      throw new ForbiddenException('User does not have access to this tenant');
    }

    // Update user's active tenant
    await this.prismaService.user.update({
      where: { id: userId },
      data: { tenantId },
    });

    return { success: true, tenantId };
  }

  /**
   * Update user's market limit (admin only)
   */
  async updateMarketLimit(userId: string, limit: number) {
    if (limit < 1) {
      throw new BadRequestException('Market limit must be at least 1');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prismaService.user.update({
      where: { id: userId },
      data: { marketLimit: limit },
    });
  }

  /**
   * Get user's market limit
   */
  async getUserMarketLimit(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { marketLimit: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentCount = await this.prismaService.userTenant.count({
      where: { userId, isOwner: true },
    });

    return {
      limit: user.marketLimit,
      currentCount,
      remaining: Math.max(0, user.marketLimit - currentCount),
    };
  }

  /**
   * Create tenant in auth database and link to user
   */
  async createTenantAndLink(userId: string, tenantData: { id: string; name: string; subdomain: string; plan?: string; status?: string }) {
    // Check market limit
    const limitCheck = await this.canCreateMarket(userId);
    if (!limitCheck.allowed) {
      throw new ForbiddenException(
        `Market limit reached. You have ${limitCheck.currentCount} of ${limitCheck.limit} markets.`
      );
    }

    // Create tenant in auth database
    let tenant;
    try {
      tenant = await this.prismaService.tenant.create({
        data: {
          id: tenantData.id,
          name: tenantData.name,
          subdomain: tenantData.subdomain,
          plan: (tenantData.plan as any) || 'STARTER',
          status: (tenantData.status as any) || 'ACTIVE',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const field = error.meta?.target?.[0] || 'subdomain';
        throw new ConflictException(`Tenant with this ${field} already exists in authentication database`);
      }
      throw error;
    }

    this.logger.log(`✅ Created tenant ${tenant.id} (${tenant.name}) for user ${userId}`);

    // Link ONLY the creator user to tenant (ensure no other users are linked)
    const userTenant = await this.linkUserToTenant(userId, tenant.id, true);
    
    // Verify the link was created correctly
    if (userTenant.userId !== userId) {
      this.logger.error(`❌ CRITICAL: Tenant ${tenant.id} was linked to wrong user! Expected ${userId}, got ${userTenant.userId}`);
      throw new InternalServerErrorException('Failed to link tenant to user correctly');
    }
    
    this.logger.log(`✅ Linked tenant ${tenant.id} to user ${userId} (isOwner: ${userTenant.isOwner})`);

    // Update user's active tenant if they don't have one
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });

    if (!user?.tenantId) {
      await this.prismaService.user.update({
        where: { id: userId },
        data: { tenantId: tenant.id },
      });
      this.logger.log(`✅ Set tenant ${tenant.id} as active tenant for user ${userId}`);
    }

    return tenant;
  }

  /**
   * Update tenant details (logo, name, etc.)
   */
  async updateTenant(tenantId: string, data: { name?: string; logo?: string; subdomain?: string }) {
    const tenant = await this.prismaService.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(`Update tenant ${tenantId} details: ${JSON.stringify(data)}`);
    
    return this.prismaService.tenant.update({
      where: { id: tenantId },
      data,
    });
  }

  /**
   * Setup 2FA: Generate secret and QR code for a user
   */
  async setupTwoFactor(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const secret = authenticator.generateSecret();
    const appName = process.env.PLATFORM_NAME || 'Koun';
    const otpauthUrl = authenticator.keyuri(user.email, appName, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      secret,
      qrCodeDataUrl,
    };
  }

  /**
   * Enable 2FA: Verify code and save secret to user record
   */
  async enableTwoFactor(userId: string, secret: string, code: string) {
    const isValid = authenticator.verify({
      token: code,
      secret: secret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: true,
      },
    });

    return { success: true };
  }

  /**
   * Disable 2FA
   */
  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled for this user');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
      },
    });

    return { success: true };
  }

  /**
   * Verify 2FA code during login for Users
   */
  async verifyLogin2FA(userId: string, code: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: { tenant: true }
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor authentication is not enabled or user not found');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      await this.logSecurityEvent(
        'INVALID_2FA_CODE',
        'MEDIUM',
        user.id,
        user.tenantId,
        ipAddress,
        userAgent,
        `Invalid 2FA code entered for user: ${user.email}`
      );
      throw new UnauthorizedException('Invalid verification code');
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`✅ User logged in via 2FA: ${user.email}`);

    // Log successful login
    await this.logSecurityEvent(
      'TWO_FACTOR_LOGIN',
      'LOW',
      user.id,
      user.tenantId,
      ipAddress,
      userAgent,
      `Successful login via 2FA for user: ${user.email}`,
      { loginMethod: '2fa' }
    );

    return {
      id: user.id,
      email: user.email,
      username: user.username || undefined,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant?.name,
      tenantSubdomain: user.tenant?.subdomain,
      avatar: user.avatar,
      twoFactorEnabled: user.twoFactorEnabled,
      ...tokens,
    };
  }
}

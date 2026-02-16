// apps/app-auth/src/email/email.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: nodemailer.Transporter;
  private useResend = false;
  private isTestAccount = false;
  private initializationPromise!: Promise<void>;
  private testAccountCredentials: any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  onModuleInit() {
    this.initializationPromise = this.initializeTransporter().then(() => {});
  }

  private async initializeTransporter() {
    // Log configuration (without password)
    this.logger.log(`📧 Email service initializing...`);
    
    // Check for Resend - if configured, prefer Resend but still initialize SMTP as fallback
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      this.useResend = true;
      const resendFrom = process.env.RESEND_FROM || 'onboarding@resend.dev';
      this.logger.log(`✅ Resend configuration detected (API Key starts with ${resendApiKey.substring(0, 5)})`);
      this.logger.log(`📧 Resend default sender: ${resendFrom}`);
      if (resendFrom === 'onboarding@resend.dev') {
        this.logger.warn(`⚠️ Using default Resend 'onboarding' email. This ONLY works for sending to your own email address.`);
      }
    } else {
      this.logger.warn(`⚠️ No Resend API key detected - will rely on SMTP as primary`);
    }
    
    this.logger.log(`📧 Initializing SMTP transporter...`);
    
    // Initialize SMTP/Nodemailer (either as primary or as fallback for Resend)
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const isGmail = smtpHost?.includes('gmail.com') || false;
    
    // If SMTP credentials are provided, try to use them, but fallback to test account if they fail
    if (smtpUser && smtpPass) {
      this.logger.log(`📧 Attempting to configure Gmail SMTP with user: ${smtpUser}`);
      try {
        // Always use Gmail service configuration for Gmail
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass, // Gmail App Password (16 characters, no spaces)
          },
          tls: {
            // Fix: Allow self-signed certificates which often cause issues in local/windows environments
            rejectUnauthorized: false
          }
        });
        const maskedUser = (smtpUser || '').includes('@') 
          ? (smtpUser || '').split('@')[0].substring(0, 3) + '...' + (smtpUser || '').split('@')[1]
          : (smtpUser || '').substring(0, 3) + '...';
        this.logger.log(`✅ Gmail transporter created (user: ${maskedUser})`);
        
        // Verify connection configuration - CRITICAL for real email delivery
        this.logger.log(`📧 Verifying Gmail SMTP connection...`);
        const verified = await this.verifyConnection();
        
        if (!verified) {
          // Don't silently fallback - throw error to force fixing Gmail credentials
          this.logger.error('❌ ========================================');
          this.logger.error('❌ GMAIL SMTP VERIFICATION FAILED!');
          this.logger.error('❌ Emails will NOT be sent to real inboxes!');
          this.logger.error('❌ ========================================');
          this.logger.error('❌ Your Gmail App Password is invalid or expired.');
          this.logger.error('❌ FIX IT NOW:');
          this.logger.error('❌ 1. Go to: https://myaccount.google.com/apppasswords');
          this.logger.error('❌ 2. Sign in with: ' + smtpUser);
          this.logger.error('❌ 3. Generate NEW App Password for "Mail"');
          this.logger.error('❌ 4. Copy 16-character password (remove spaces)');
          this.logger.error('❌ 5. Update SMTP_PASS in .env file');
          this.logger.error('❌ 6. Restart server');
          this.logger.error('❌ ========================================');
          
          // Only use test account in development mode
          if (process.env.NODE_ENV === 'development') {
            this.logger.warn('⚠️ Development mode: Using test account (emails go to preview URL only)');
            await this.createTestAccount();
          } else {
            // In production, log error but don't crash startup. Email sending will fail later if not fixed.
            this.logger.error('❌ CRITICAL: Gmail SMTP verification failed in PRODUCTION. Real emails cannot be sent.');
            this.logger.error('❌ Fix SMTP_PASS in .env file immediately.');
            // Ensure isTestAccount is false so we get real errors instead of fake successes
            this.isTestAccount = false;
          }
        } else {
          this.isTestAccount = false; // Mark as real SMTP
          this.logger.log(`✅ Gmail SMTP verified! Real emails will be sent to user inboxes.`);
        }
      } catch (error) {
        this.logger.error(`❌ Failed to configure Gmail SMTP: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.message.includes('Invalid login')) {
          this.logger.error('❌ Gmail authentication failed - App Password is invalid');
        }
        if (process.env.NODE_ENV === 'development') {
          this.logger.warn('⚠️ Falling back to test account (Ethereal.email) - emails will NOT go to real inboxes');
          await this.createTestAccount();
        } else {
          this.logger.error(`❌ SMTP configuration failed in production: ${error instanceof Error ? error.message : String(error)}`);
          this.isTestAccount = false;
        }
      }
    } else {
      // No SMTP credentials
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn('⚠️ SMTP credentials not configured - using test account');
        await this.createTestAccount();
      } else {
        this.logger.error('❌ SMTP credentials not configured in production .env file');
        this.isTestAccount = false;
      }
    }
  }

  private async createTestAccount() {
    try {
      this.logger.log('📧 Creating Ethereal.email test account...');
      // Create a test account using nodemailer's built-in test account generator
      const testAccount = await nodemailer.createTestAccount();
      this.testAccountCredentials = testAccount;
      
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      
      this.isTestAccount = true;
      this.logger.log('✅ Test email account created successfully (Ethereal.email)');
      this.logger.log(`📧 Test account email: ${testAccount.user}`);
      this.logger.log(`📧 Test account password: ${testAccount.pass}`);
      this.logger.warn('⚠️ Using test email service - emails will NOT be delivered to real inboxes');
      this.logger.warn('⚠️ Use preview URL to view emails or configure real Gmail SMTP for production');
      
      // Verify connection
      const verified = await this.verifyConnection();
      if (!verified) {
        throw new Error('Failed to verify test account connection');
      }
    } catch (error) {
      this.logger.error('❌ Failed to create test account:', error);
      this.logger.error(`Error details: ${error instanceof Error ? error.message : String(error)}`);
      // Try one more time
      try {
        this.logger.log('📧 Retrying test account creation...');
        const testAccount = await nodemailer.createTestAccount();
        this.testAccountCredentials = testAccount;
        
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        
        this.isTestAccount = true;
        this.logger.log('✅ Test account created on retry');
        await this.verifyConnection();
      } catch (retryError) {
        this.logger.error('❌ Failed to create test account after retry:', retryError);
        // Last resort: use JSON transport (emails logged only)
        this.transporter = nodemailer.createTransport({
          jsonTransport: true,
        });
        this.logger.warn('⚠️ Using JSON transport - emails will be logged in console only');
      }
    }
  }

  private async verifyConnection(): Promise<boolean> {
    try {
      this.logger.log('📧 Verifying SMTP connection...');
      
      // CPU Safety: Add timeout to verification to prevent hanging
      const VERIFY_TIMEOUT_MS = 5000; // 5 seconds for verification
      await Promise.race([
        this.transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('SMTP verification timeout')), VERIFY_TIMEOUT_MS)
        )
      ]);
      
      this.logger.log('✅ SMTP connection verified successfully');
      return true;
    } catch (error: any) {
      this.logger.error('❌ ========================================');
      this.logger.error('❌ SMTP CONNECTION VERIFICATION FAILED');
      this.logger.error('❌ ========================================');
      
      if (error instanceof Error) {
        const errorCode = (error as any).code || 'N/A';
        const errorMessage = error.message;
        
        this.logger.error(`Error code: ${errorCode}`);
        this.logger.error(`Error message: ${errorMessage}`);
        
        // Provide specific help for Gmail errors
        if (errorCode === 'EAUTH' || errorMessage.includes('Invalid login') || errorMessage.includes('authentication failed')) {
          this.logger.error('❌ ========================================');
          this.logger.error('❌ GMAIL AUTHENTICATION FAILED!');
          this.logger.error('❌ The App Password is INCORRECT or EXPIRED');
          this.logger.error('❌ ========================================');
          this.logger.error('❌ TO FIX THIS:');
          this.logger.error('❌ 1. Go to: https://myaccount.google.com/apppasswords');
          this.logger.error('❌ 2. Sign in with: crunchy.helpdesk.team@gmail.com');
          this.logger.error('❌ 3. Make sure 2-Step Verification is ENABLED');
          this.logger.error('❌ 4. Click "Select app" → Choose "Mail"');
          this.logger.error('❌ 5. Click "Select device" → Choose "Other" → Type "Server"');
          this.logger.error('❌ 6. Click "Generate"');
          this.logger.error('❌ 7. Copy the 16-character password (like: abcd efgh ijkl mnop)');
          this.logger.error('❌ 8. REMOVE SPACES and update SMTP_PASS in .env');
          this.logger.error('❌ 9. Restart the server');
          this.logger.error('❌ ========================================');
        } else if (errorCode === 'ECONNECTION') {
          this.logger.error('❌ Connection error - check your internet connection');
        } else {
          this.logger.error('❌ Unknown error - check server logs for details');
        }
      } else {
        this.logger.error(`Unexpected error: ${String(error)}`);
      }
      
      this.logger.error('❌ ========================================');
      
      if (!this.isTestAccount) {
        this.logger.warn('⚠️ Email sending will fail until SMTP is properly configured');
      }
      return false;
    }
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<{ messageId: string; previewUrl: string }> {
    // If RESEND_API_KEY is configured, prefer Resend over SMTP
    if (this.useResend || process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // For Resend, use onboarding@resend.dev as safe default (works without domain verification)
      // Don't fall back to SMTP_USER which might be a Gmail address that Resend rejects
      const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
      const platformName = process.env.PLATFORM_NAME || 'Saeaa';
      const fromName = process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || platformName;

      try {
        const result: any = await (resend as any).emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: 'Password Reset Code',
          html: `<p>You requested to reset your password. Use this code: <strong>${code}</strong></p>`,
        });
        const messageId = result?.id || result?.data?.id || 'resend';
        if (result.error) throw new Error(result.error.message || 'Unknown Resend error');
        
        this.logger.log(`Password reset email sent via Resend to ${email}, Message ID: ${messageId}`);
        return { messageId, previewUrl: '' };
      } catch (error: any) {
        this.logger.error(`Failed to send password reset email via Resend to ${email}: ${error.message || error}`);
        this.logger.warn('⚠️ Falling back to SMTP...');
        // Fall through to SMTP logic
      }
    }

    // Ensure transporter is initialized (SMTP / test account path)
    await this.initializationPromise;
    
    // CPU Safety: Add timeout protection
    const EMAIL_TIMEOUT_MS = 10000; // 10 seconds max

    let fromEmail: string;
    let fromName: string;
    
    if (this.isTestAccount && this.testAccountCredentials) {
      fromEmail = this.testAccountCredentials.user;
      const platformName = process.env.PLATFORM_NAME || 'Saeaa';
      fromName = process.env.SMTP_FROM_NAME || `${platformName} (Test)`;
    } else {
      const platformName = process.env.PLATFORM_NAME || 'Saeaa';
      const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || (process.env.PLATFORM_EMAIL || `noreply@${platformDomain}`);
      fromName = process.env.SMTP_FROM_NAME || platformName;
    }
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: 'Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>You requested to reset your password. Use the code below to reset your password:</p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0;">
            <strong>${code}</strong>
          </div>
          <p>This code will expire in 15 minutes.</p>
          <p>If you didn't request this reset, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">E-Commerce Platform Team</p>
        </div>
      `,
    };

    try {
      // CPU Safety: Add timeout to prevent hanging
      const sendEmailWithTimeout = Promise.race([
        this.transporter.sendMail(mailOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email sending timeout')), EMAIL_TIMEOUT_MS)
        )
      ]);
      
      const info: any = await sendEmailWithTimeout;
      this.logger.log(`Password reset email sent successfully to ${email}, Message ID: ${info.messageId}`);
      
      return {
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info) || ''
      };
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${email}:`, error);
      // Provide more helpful error messages
      if ((error as any).code === 'EAUTH') {
        throw new Error('Email authentication failed. Please check SMTP credentials.');
      } else if ((error as any).code === 'ECONNECTION') {
        throw new Error('Failed to connect to SMTP server. Please check SMTP settings.');
      }
      throw new Error(`Failed to send password reset email: ${error.message || error}`);
    }
  }

  async sendPasswordResetLinkEmail(email: string, token: string, tenantId?: string): Promise<{ messageId: string; previewUrl: string }> {
    // Determine if this is a Koun platform email (no tenantId or system tenant)
    const isKounPlatformEmail = !tenantId || tenantId === 'default' || tenantId === 'system';
    
    // Fetch tenant branding if tenantId is provided
    const platformName = process.env.PLATFORM_NAME || 'Saeaa';
    const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
    let brandName = platformName;
    let brandLogo = process.env.EMAIL_LOGO_URL || 
      (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/branding/logo.png` :
      `https://${platformDomain}/branding/logo.png`);

    if (!isKounPlatformEmail) {
      try {
        const tenant = await this.prisma.tenant.findFirst({
          where: { OR: [{ id: tenantId }, { subdomain: tenantId }] },
          select: { name: true, logo: true }
        });
        if (tenant) {
          brandName = tenant.name;
          if (tenant.logo) brandLogo = tenant.logo;
        }
      } catch (e) {}
    }

    // Build reset link
    const platformDomain2 = process.env.PLATFORM_DOMAIN || 'kounworld.com';
    let frontendUrl = process.env.FRONTEND_URL || `https://${platformDomain2}`;
    frontendUrl = frontendUrl.replace(/\/+$/, '');
    
    // Fix port for development
    try {
      const urlObj = new URL(frontendUrl);
      const port = urlObj.port;
      if (port === '3001' || port === '3002') {
        urlObj.port = '5173';
        frontendUrl = urlObj.toString();
      } else if (urlObj.protocol === 'http:' && urlObj.hostname === 'localhost' && (!port || port === '')) {
        urlObj.port = '5173';
        frontendUrl = urlObj.toString();
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to parse FRONTEND_URL (${frontendUrl}), using as-is`);
    }
    frontendUrl = frontendUrl.replace(/\/+$/, '');
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    // ============================================================
    // KAWN PLATFORM EMAIL - PREMIUM CREATIVE DESIGN
    // ============================================================
    const kawnPremiumEmailTemplate = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh;">
        
        <!-- Outer Container with Dark Gradient -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 40px 20px;">
          <tr>
            <td align="center">
              
              <!-- Decorative Top Glow -->
              <div style="width: 200px; height: 200px; background: radial-gradient(circle, rgba(6,182,212,0.3) 0%, transparent 70%); position: absolute; top: 0; left: 50%; transform: translateX(-50%); pointer-events: none;"></div>
              
              <!-- Main Email Card -->
              <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(6,182,212,0.1), inset 0 1px 0 rgba(255,255,255,0.05); border: 1px solid rgba(6,182,212,0.2);">
                
                <!-- Premium Header with Animated-Look Gradient -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 50px 40px; text-align: center; position: relative; border-bottom: 1px solid rgba(6,182,212,0.2);">
                    
                    <!-- Glowing Logo Container -->
                    <div style="display: inline-block; padding: 20px; background: linear-gradient(145deg, rgba(6,182,212,0.1) 0%, rgba(6,182,212,0.05) 100%); border-radius: 20px; border: 1px solid rgba(6,182,212,0.2); box-shadow: 0 0 40px rgba(6,182,212,0.2), inset 0 1px 0 rgba(255,255,255,0.05);">
                      <img src="${brandLogo}" alt="Koun Logo" style="max-width: 120px; height: auto; filter: drop-shadow(0 0 20px rgba(6,182,212,0.5));" />
                    </div>
                    
                    <!-- Brand Name with Glow -->
                    <h1 style="color: #ffffff; margin: 25px 0 0 0; font-size: 48px; font-weight: 800; letter-spacing: 4px; text-shadow: 0 0 40px rgba(6,182,212,0.5);">
                      <span style="color: #06B6D4;">ك</span>ون
                    </h1>
                    
                    <!-- Tagline -->
                    <p style="color: #06B6D4; margin: 10px 0 0 0; font-size: 16px; font-weight: 600; letter-spacing: 2px;">
                      ✦ منصة التجارة الإلكترونية الرائدة ✦
                    </p>
                    
                    <!-- Decorative Line -->
                    <div style="width: 80px; height: 3px; background: linear-gradient(90deg, transparent, #06B6D4, transparent); margin: 25px auto 0; border-radius: 2px;"></div>
                  </td>
                </tr>
                
                <!-- Main Content Area -->
                <tr>
                  <td style="padding: 50px 40px;">
                    
                    <!-- Security Icon -->
                    <div style="text-align: center; margin-bottom: 30px;">
                      <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(145deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%); border-radius: 50%; border: 2px solid rgba(6,182,212,0.3); line-height: 80px; font-size: 36px; box-shadow: 0 0 30px rgba(6,182,212,0.2);">
                        🔐
                      </div>
                    </div>
                    
                    <!-- Title -->
                    <h2 style="color: #ffffff; margin: 0 0 20px 0; font-size: 28px; font-weight: 700; text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">
                      إعادة تعيين كلمة المرور
                    </h2>
                    
                    <!-- Subtitle -->
                    <p style="color: #94a3b8; margin: 0 0 35px 0; font-size: 16px; line-height: 1.8; text-align: center;">
                      تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في منصة <span style="color: #06B6D4; font-weight: 600;">كون</span>
                    </p>
                    
                    <!-- CTA Button Container -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                      <tr>
                        <td align="center">
                          <!-- Premium Button -->
                          <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #06B6D4 0%, #0891b2 50%, #0e7490 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 40px rgba(6,182,212,0.4), 0 0 0 1px rgba(255,255,255,0.1) inset; text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: all 0.3s ease;">
                            إعادة تعيين الآن ←
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Time Limit Notice Card -->
                    <div style="background: linear-gradient(145deg, rgba(251,191,36,0.1) 0%, rgba(251,191,36,0.05) 100%); border: 1px solid rgba(251,191,36,0.3); border-radius: 16px; padding: 20px 25px; margin: 30px 0; text-align: center;">
                      <p style="color: #fbbf24; margin: 0; font-size: 14px; font-weight: 600;">
                        ⏱️ صالح لمدة 15 دقيقة فقط
                      </p>
                    </div>
                    
                    <!-- Link Fallback Section -->
                    <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; margin-top: 30px; border: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #64748b; margin: 0 0 10px 0; font-size: 13px; text-align: center;">
                        إذا لم يعمل الزر، انسخ هذا الرابط:
                      </p>
                      <p style="margin: 0; text-align: center;">
                        <a href="${resetLink}" style="color: #06B6D4; word-break: break-all; font-size: 11px; text-decoration: none; opacity: 0.8;">${resetLink}</a>
                      </p>
                    </div>
                    
                    <!-- Security Notice -->
                    <div style="margin-top: 35px; padding-top: 25px; border-top: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #475569; margin: 0; font-size: 12px; line-height: 1.8; text-align: center;">
                        🛡️ إذا لم تطلب هذا التغيير، تجاهل هذا البريد. حسابك آمن.
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- Premium Footer -->
                <tr>
                  <td style="background: linear-gradient(180deg, rgba(6,182,212,0.05) 0%, rgba(6,182,212,0.02) 100%); padding: 35px 40px; text-align: center; border-top: 1px solid rgba(6,182,212,0.1);">
                    
                    <!-- Features Row -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                      <tr>
                        <td width="33%" style="text-align: center; padding: 10px;">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🚀</div>
                          <div style="color: #94a3b8; font-size: 11px;">سرعة فائقة</div>
                        </td>
                        <td width="33%" style="text-align: center; padding: 10px; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05);">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🔒</div>
                          <div style="color: #94a3b8; font-size: 11px;">أمان متقدم</div>
                        </td>
                        <td width="33%" style="text-align: center; padding: 10px;">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">💎</div>
                          <div style="color: #94a3b8; font-size: 11px;">جودة عالية</div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Copyright -->
                    <p style="color: #475569; margin: 0 0 15px 0; font-size: 13px;">
                      <span style="color: #06B6D4;">كون</span> — شريكك في النجاح الرقمي
                    </p>
                    
                    <p style="color: #334155; margin: 0; font-size: 11px;">
                      © ${new Date().getFullYear()} Koun Platform. جميع الحقوق محفوظة.
                    </p>
                    
                    <!-- Social Links -->
                    <div style="margin-top: 20px;">
                      <a href="https://kawn.com" style="color: #06B6D4; text-decoration: none; margin: 0 15px; font-size: 12px; opacity: 0.8;">🌐 الموقع</a>
                      <a href="#" style="color: #06B6D4; text-decoration: none; margin: 0 15px; font-size: 12px; opacity: 0.8;">📧 الدعم</a>
                      <a href="#" style="color: #06B6D4; text-decoration: none; margin: 0 15px; font-size: 12px; opacity: 0.8;">📱 التطبيق</a>
                    </div>
                  </td>
                </tr>
              </table>
              
              <!-- Bottom Branding -->
              <p style="color: #334155; margin: 30px 0 0 0; font-size: 11px; text-align: center;">
                تم الإرسال بواسطة منصة كون للتجارة الإلكترونية
              </p>
              
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // ============================================================
    // STORE EMAIL - SIMPLE PROFESSIONAL DESIGN
    // ============================================================
    const storeEmailTemplate = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #f8fafc;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <!-- Header with Logo -->
                <tr>
                  <td style="background: linear-gradient(135deg, #1E293B 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
                    <img src="${brandLogo}" alt="${brandName} Logo" style="max-width: 150px; height: auto; margin-bottom: 10px; border-radius: 8px;" />
                    <h1 style="color: #ffffff; margin: 10px 0 0 0; font-size: 24px; font-weight: 700;">${brandName}</h1>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #1E293B; margin: 0 0 20px 0; font-size: 22px; font-weight: 700; text-align: right;">
                      🔐 إعادة تعيين كلمة المرور
                    </h2>
                    
                    <p style="color: #475569; margin: 0 0 25px 0; font-size: 16px; line-height: 1.7; text-align: right;">
                      مرحباً،<br>
                      تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في <strong>${brandName}</strong>.
                    </p>
                    
                    <!-- Reset Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                      <tr>
                        <td align="center">
                          <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #06B6D4 0%, #0891b2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(6, 182, 212, 0.3);">
                            إعادة تعيين كلمة المرور
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <div style="background-color: #fef3c7; border-right: 4px solid #f59e0b; padding: 15px; border-radius: 8px; margin: 25px 0;">
                      <p style="color: #92400e; margin: 0; font-size: 13px; text-align: right;">
                        <strong>⏰ تنبيه:</strong> الرابط صالح لمدة 15 دقيقة فقط.
                      </p>
                    </div>
                    
                    <p style="color: #64748b; margin: 20px 0 0 0; font-size: 13px; text-align: right;">
                      أو انسخ الرابط: <a href="${resetLink}" style="color: #06B6D4; word-break: break-all;">${resetLink}</a>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f1f5f9; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="color: #64748b; margin: 0; font-size: 12px;">
                      © ${new Date().getFullYear()} ${brandName}. جميع الحقوق محفوظة.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Choose template based on whether it's a Koun platform email or store email (renaming variable)
      const htmlTemplate = isKounPlatformEmail ? kawnPremiumEmailTemplate : storeEmailTemplate;

    // If RESEND_API_KEY is configured, prefer Resend over SMTP
    if (this.useResend || process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
      const fromName = brandName;

      try {
        const result: any = await (resend as any).emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: `إعادة تعيين كلمة المرور - ${brandName}`,
          html: htmlTemplate,
        });
        const messageId = result?.id || result?.data?.id || 'resend';
        if (result.error) throw new Error(result.error.message || 'Unknown Resend error');

        this.logger.log(`Password reset link email sent via Resend to ${email}, Message ID: ${messageId}`);
        return { messageId, previewUrl: '' };
      } catch (error: any) {
        this.logger.error(`Failed to send password reset link email via Resend to ${email}: ${error.message || error}`);
        this.logger.warn('⚠️ Falling back to SMTP...');
        // Fall through to SMTP logic
      }
    }

    // Ensure transporter is initialized (SMTP / test account path)
    await this.initializationPromise;
    
    // CPU Safety: Add timeout protection
    const EMAIL_TIMEOUT_MS = 10000;

    let fromEmail: string;
    let fromName: string;

    if (this.isTestAccount && this.testAccountCredentials) {
      fromEmail = this.testAccountCredentials.user;
      fromName = brandName + ' (Test)';
    } else {
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || (process.env.PLATFORM_EMAIL || 'noreply@kounworld.com');
      fromName = brandName;
    }
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: `إعادة تعيين كلمة المرور - ${brandName}`,
      html: htmlTemplate,
    };

    try {
      this.logger.log(`📧 ========================================`);
      this.logger.log(`📧 SENDING PASSWORD RESET LINK EMAIL`);
      this.logger.log(`📧 Template: ${isKounPlatformEmail ? 'KOUN PREMIUM' : 'STORE STANDARD'}`);
      this.logger.log(`📧 Recipient: ${email}`);
      this.logger.log(`📧 Reset Link: ${resetLink}`);
      this.logger.log(`📧 ========================================`);
      
      const sendEmailWithTimeout = Promise.race([
        this.transporter.sendMail(mailOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email sending timeout')), EMAIL_TIMEOUT_MS)
        )
      ]);
      
      const info: any = await sendEmailWithTimeout;
      this.logger.log(`✅ Email sent! Message ID: ${info.messageId}`);
      
      const previewUrl = nodemailer.getTestMessageUrl(info);
      
      if (previewUrl || this.isTestAccount) {
        this.logger.warn(`🔗 Preview URL: ${previewUrl || 'N/A'}`);
      }
      
      return {
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info) || ''
      };
    } catch (error: any) {
      if (email.includes('@example.com')) {
         this.logger.warn(`Skipping actual email sending for example domain: ${email}`);
         return { messageId: 'skipped', previewUrl: '' };
      }
      this.logger.error(`Failed to send email to ${email}: ${error.message || error}`);
      if ((error as any).code === 'EAUTH') {
        this.logger.error('Email authentication failed. Please check SMTP credentials.');
        throw new Error('Email authentication failed. Please check SMTP credentials.');
      }
      throw error;
    }
  }

  async sendVerificationEmail(
    email: string, 
    code: string, 
    tenantId?: string,
    customBrandName?: string,
    customLogoUrl?: string
  ): Promise<{ messageId: string; previewUrl: string; isTestEmail?: boolean; code?: string }> {
    
    const platformName = process.env.PLATFORM_NAME || 'Saeaa';
    const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
    const platformLogo = process.env.EMAIL_LOGO_URL || 
      (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/branding/logo.png` :
      `https://${platformDomain}/branding/logo.png`);

    // Branding resolution
    let brandName = customBrandName || platformName;
    let brandLogo = customLogoUrl || platformLogo;
    let isStoreBranded = !!customBrandName;

    // Get tenant URL for the CTA button (still useful for directing user to correct store)
    let tenantSubdomain = 'default';
    let tenantUrl = process.env.FRONTEND_URL || 'https://kounworld.com';
    
    if (tenantId && tenantId !== 'system' && tenantId !== 'default') {
      try {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { subdomain: true, name: true, logo: true }
        });
        
        if (tenant) {
          tenantSubdomain = tenant.subdomain;
          if (!customBrandName) brandName = tenant.name || brandName;
          if (!customLogoUrl && tenant.logo) brandLogo = tenant.logo;
          isStoreBranded = true;
          
          // Construct tenant URL
          // If in development mode AND frontend URL is localhost, use loopback address
          // Otherwise use production domain logic (even if checking locally against prod)
          if (process.env.NODE_ENV === 'development' && (process.env.FRONTEND_URL || '').includes('localhost')) {
            let port = '8080';
            try {
              const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
              const urlObj = new URL(frontendUrl);
              port = urlObj.port || '8080';
            } catch (e) {
              port = '8080';
            }
            const portPart = port && port !== '80' && port !== '443' ? `:${port}` : '';
            tenantUrl = `http://${tenantSubdomain}.localhost${portPart}`;
          } else {
            const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
            // Use FRONTEND_URL base if available, strictly stripping subdomains to get root domain
            const baseDomain = process.env.FRONTEND_URL 
              ? new URL(process.env.FRONTEND_URL).hostname.replace('app.', '').replace('www.', '') 
              : platformDomain;
            tenantUrl = `https://${tenantSubdomain}.${baseDomain}`;
          }
        }
      } catch (error: unknown) {
        this.logger.warn(`❌ Failed to fetch tenant info for ${tenantId}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`📧 OTP Email Branding: Always using Koun platform branding. Target Store URL: ${tenantUrl}`);

    // If Resend is configured, use it first (check flag set during initialization)
    if (this.useResend || process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // For Resend, use onboarding@resend.dev as safe default (works without domain verification)
      // Don't fall back to SMTP_USER which might be a Gmail address that Resend rejects
      const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
      // Use the brand name directly - the SDK or nodemailer will handle quoting if needed
      const fromName = brandName; 
      
      // Log exactly what we're trying to do
      this.logger.log(`📧 Attempting to send verification email via Resend: ${fromName} <${fromEmail}> to ${email}`);
      
      // Determine if this is a Koun platform email
      const isKounPlatformEmail = !isStoreBranded && (brandName === platformName || brandName === 'Koun' || brandName === 'كون');
      
      // Premium Koun Template for platform emails
      const kawnPremiumTemplate = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh;">
          
          <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 40px 20px;">
            <tr>
              <td align="center">
                
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.2);">
                  
                  <!-- Premium Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 50px 40px; text-align: center; border-bottom: 1px solid rgba(6,182,212,0.2);">
                      
                      <div style="display: inline-block; padding: 20px; background: linear-gradient(145deg, rgba(6,182,212,0.1) 0%, rgba(6,182,212,0.05) 100%); border-radius: 20px; border: 1px solid rgba(6,182,212,0.2); box-shadow: 0 0 40px rgba(6,182,212,0.2);">
                        <img src="${brandLogo}" alt="كون Logo" style="max-width: 120px; height: auto; filter: drop-shadow(0 0 20px rgba(6,182,212,0.5));" />
                      </div>
                      
                      <h1 style="color: #ffffff; margin: 25px 0 0 0; font-size: 48px; font-weight: 800; letter-spacing: 4px; text-shadow: 0 0 40px rgba(6,182,212,0.5);">
                        <span style="color: #06B6D4;">ك</span>ون
                      </h1>
                      
                      <p style="color: #06B6D4; margin: 10px 0 0 0; font-size: 16px; font-weight: 600; letter-spacing: 2px;">
                        ✦ منصة التجارة الإلكترونية الرائدة ✦
                      </p>
                      
                      <div style="width: 80px; height: 3px; background: linear-gradient(90deg, transparent, #06B6D4, transparent); margin: 25px auto 0; border-radius: 2px;"></div>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 50px 40px;">
                      
                      <!-- Welcome Icon -->
                      <div style="text-align: center; margin-bottom: 30px;">
                        <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(145deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%); border-radius: 50%; border: 2px solid rgba(6,182,212,0.3); line-height: 80px; font-size: 36px; box-shadow: 0 0 30px rgba(6,182,212,0.2);">
                          🎉
                        </div>
                      </div>
                      
                      <h2 style="color: #ffffff; margin: 0 0 20px 0; font-size: 28px; font-weight: 700; text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">
                        مرحباً بك في <span style="color: #06B6D4;">كون</span>!
                      </h2>
                      
                      <p style="color: #94a3b8; margin: 0 0 35px 0; font-size: 16px; line-height: 1.8; text-align: center;">
                        نشكرك على التسجيل معنا. استخدم الرمز التالي لتأكيد حسابك:
                      </p>
                      
                      <!-- OTP Code Box -->
                      <div style="background: linear-gradient(135deg, #06B6D4 0%, #0891b2 100%); border-radius: 16px; padding: 30px; text-align: center; margin: 30px 0; box-shadow: 0 10px 40px rgba(6,182,212,0.3);">
                        <p style="color: rgba(255,255,255,0.9); margin: 0 0 15px 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">
                          رمز التحقق
                        </p>
                        <div style="background: rgba(255,255,255,0.95); border-radius: 12px; padding: 25px 40px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                          <p style="color: #0f172a; margin: 0; font-size: 42px; font-weight: 800; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                            ${code}
                          </p>
                        </div>
                        <p style="color: rgba(255,255,255,0.8); margin: 20px 0 0 0; font-size: 13px;">
                          ⏱️ صالح لمدة 15 دقيقة
                        </p>
                      </div>
                      
                      <!-- Security Notice -->
                      <div style="margin-top: 35px; padding-top: 25px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <p style="color: #475569; margin: 0; font-size: 12px; line-height: 1.8; text-align: center;">
                          🛡️ إذا لم تقم بإنشاء هذا الحساب، يرجى تجاهل هذا البريد الإلكتروني.
                        </p>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Premium Footer -->
                  <tr>
                    <td style="background: linear-gradient(180deg, rgba(6,182,212,0.05) 0%, rgba(6,182,212,0.02) 100%); padding: 35px 40px; text-align: center; border-top: 1px solid rgba(6,182,212,0.1);">
                      
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                        <tr>
                          <td width="33%" style="text-align: center; padding: 10px;">
                            <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🚀</div>
                            <div style="color: #94a3b8; font-size: 11px;">سرعة فائقة</div>
                          </td>
                          <td width="33%" style="text-align: center; padding: 10px; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05);">
                            <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🔒</div>
                            <div style="color: #94a3b8; font-size: 11px;">أمان متقدم</div>
                          </td>
                          <td width="33%" style="text-align: center; padding: 10px;">
                            <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">💎</div>
                            <div style="color: #94a3b8; font-size: 11px;">جودة عالية</div>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #475569; margin: 0 0 15px 0; font-size: 13px;">
                        <span style="color: #06B6D4;">كون</span> — شريكك في النجاح الرقمي
                      </p>
                      
                      <p style="color: #334155; margin: 0; font-size: 11px;">
                        © ${new Date().getFullYear()} Koun Platform. جميع الحقوق محفوظة.
                      </p>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #334155; margin: 30px 0 0 0; font-size: 11px; text-align: center;">
                  تم الإرسال بواسطة منصة كون للتجارة الإلكترونية
                </p>
                
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      // Standard store template
      const storeTemplate = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #f8fafc;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header with Logo -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1E293B 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
                      ${brandLogo ? `<img src="${brandLogo}" alt="${brandName} Logo" style="max-width: 150px; height: auto; margin-bottom: 10px; border-radius: 8px;" />` : ''}
                      <h1 style="color: #ffffff; margin: 10px 0 0 0; font-size: 24px; font-weight: 700;">${brandName}</h1>
                      <p style="color: #06B6D4; margin: 5px 0 0 0; font-size: 14px; font-weight: 500;">منصتك للتجارة الإلكترونية</p>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px 30px;">
                      <h2 style="color: #1E293B; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-align: right;">
                        مرحباً بك في ${brandName}! 🎉
                      </h2>
                      
                      <p style="color: #475569; margin: 0 0 25px 0; font-size: 16px; line-height: 1.6; text-align: right;">
                        نشكرك على التسجيل. استخدم الرمز التالي لتأكيد حسابك:
                      </p>
                      
                      <!-- Verification Code Box -->
                      <div style="background: linear-gradient(135deg, #06B6D4 0%, #0891b2 100%); border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0;">
                        <p style="color: #ffffff; margin: 0 0 10px 0; font-size: 14px; font-weight: 600; letter-spacing: 1px;">
                          رمز التحقق
                        </p>
                        <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; margin: 15px auto; display: inline-block;">
                          <p style="color: #1E293B; margin: 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                            ${code}
                          </p>
                        </div>
                        <p style="color: #ffffff; margin: 15px 0 0 0; font-size: 13px; opacity: 0.9;">
                          صالح لمدة 15 دقيقة
                        </p>
                      </div>
                      
                      <p style="color: #64748b; margin: 25px 0 0 0; font-size: 14px; line-height: 1.6; text-align: right;">
                        إذا لم تقم بإنشاء حساب، يرجى تجاهل هذا البريد الإلكتروني.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f1f5f9; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="color: #64748b; margin: 0 0 10px 0; font-size: 13px;">
                        <strong style="color: #1E293B;">${brandName}</strong> - منصتك الشاملة للتجارة الإلكترونية
                      </p>
                      <p style="color: #94a3b8; margin: 0; font-size: 12px;">
                        © ${new Date().getFullYear()} ${brandName}. جميع الحقوق محفوظة.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      // Choose template based on branding
      const htmlTemplate = isKounPlatformEmail ? kawnPremiumTemplate : storeTemplate;

      try {
        this.logger.log(`📧 ========================================`);
        this.logger.log(`📧 SENDING VERIFICATION EMAIL`);
        this.logger.log(`📧 Recipient: ${email}`);
        this.logger.log(`📧 Verification Code: ${code}`);
        this.logger.log(`📧 Brand: ${brandName}`);
        this.logger.log(`📧 ========================================`);
        
        const result: any = await (resend as any).emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: `رمز التحقق - ${brandName}`,
          html: htmlTemplate,
        });
        
        if (!result || result.error) {
          const errorMsg = result?.error?.message || 'Unknown Resend error or empty response';
          this.logger.error(`❌ Resend API returned error: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        const messageId = result.id || result.data?.id || 'resend';
        this.logger.log(`✅ Email sent via Resend to ${email}! Message ID: ${messageId}`);
        
        return {
          messageId,
          previewUrl: '',
          isTestEmail: false,
          code,
        };
      } catch (error: any) {
        this.logger.error(`❌ Resend failure for ${email}: ${error.message || error}`);
        this.logger.warn('⚠️ Falling back to SMTP for verification email...');
        // Fall through to SMTP logic below
      }
    }

    // SMTP fallback path
    await this.initializationPromise;
    
    // CPU Safety: Add timeout protection
    const EMAIL_TIMEOUT_MS = 10000; // 10 seconds max

    let fromEmail: string;
    let fromName: string;
    
    if (this.isTestAccount && this.testAccountCredentials) {
      fromEmail = this.testAccountCredentials.user;
      fromName = process.env.SMTP_FROM_NAME || `${process.env.PLATFORM_NAME || 'Koun'} (Test)`;
    } else {
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || (process.env.PLATFORM_EMAIL || 'noreply@kounworld.com');
      fromName = brandName;
    }
    
    this.logger.log(`📧 Attempting to send verification email via SMTP: ${fromName} <${fromEmail}> to ${email}`);
    
    // Determine if this is a Koun platform email
    const isKounPlatformEmailSMTP = !isStoreBranded && (brandName === platformName || brandName === 'Koun' || brandName === 'كون');
    
    // Premium Koun Template for SMTP
    const kounPremiumTemplateSMTP = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh;">
        
        <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 40px 20px;">
          <tr>
            <td align="center">
              
              <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.2);">
                
                <!-- Premium Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); padding: 50px 40px; text-align: center; border-bottom: 1px solid rgba(6,182,212,0.2);">
                    
                    <div style="display: inline-block; padding: 20px; background: linear-gradient(145deg, rgba(6,182,212,0.1) 0%, rgba(6,182,212,0.05) 100%); border-radius: 20px; border: 1px solid rgba(6,182,212,0.2); box-shadow: 0 0 40px rgba(6,182,212,0.2);">
                      <img src="${brandLogo}" alt="كون Logo" style="max-width: 120px; height: auto; filter: drop-shadow(0 0 20px rgba(6,182,212,0.5));" />
                    </div>
                    
                    <h1 style="color: #ffffff; margin: 25px 0 0 0; font-size: 48px; font-weight: 800; letter-spacing: 4px; text-shadow: 0 0 40px rgba(6,182,212,0.5);">
                      <span style="color: #06B6D4;">ك</span>ون
                    </h1>
                    
                    <p style="color: #06B6D4; margin: 10px 0 0 0; font-size: 16px; font-weight: 600; letter-spacing: 2px;">
                      ✦ منصة التجارة الإلكترونية الرائدة ✦
                    </p>
                    
                    <div style="width: 80px; height: 3px; background: linear-gradient(90deg, transparent, #06B6D4, transparent); margin: 25px auto 0; border-radius: 2px;"></div>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 50px 40px;">
                    
                    <!-- Welcome Icon -->
                    <div style="text-align: center; margin-bottom: 30px;">
                      <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(145deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%); border-radius: 50%; border: 2px solid rgba(6,182,212,0.3); line-height: 80px; font-size: 36px; box-shadow: 0 0 30px rgba(6,182,212,0.2);">
                        🎉
                      </div>
                    </div>
                    
                    <h2 style="color: #ffffff; margin: 0 0 20px 0; font-size: 28px; font-weight: 700; text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">
                      مرحباً بك في <span style="color: #06B6D4;">كون</span>!
                    </h2>
                    
                    <p style="color: #94a3b8; margin: 0 0 35px 0; font-size: 16px; line-height: 1.8; text-align: center;">
                      نشكرك على التسجيل معنا. استخدم الرمز التالي لتأكيد حسابك:
                    </p>
                    
                    <!-- OTP Code Box -->
                    <div style="background: linear-gradient(135deg, #06B6D4 0%, #0891b2 100%); border-radius: 16px; padding: 30px; text-align: center; margin: 30px 0; box-shadow: 0 10px 40px rgba(6,182,212,0.3);">
                      <p style="color: rgba(255,255,255,0.9); margin: 0 0 15px 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">
                        رمز التحقق
                      </p>
                      <div style="background: rgba(255,255,255,0.95); border-radius: 12px; padding: 25px 40px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        <p style="color: #0f172a; margin: 0; font-size: 42px; font-weight: 800; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                          ${code}
                        </p>
                      </div>
                      <p style="color: rgba(255,255,255,0.8); margin: 20px 0 0 0; font-size: 13px;">
                        ⏱️ صالح لمدة 15 دقيقة
                      </p>
                    </div>
                    
                    <!-- Security Notice -->
                    <div style="margin-top: 35px; padding-top: 25px; border-top: 1px solid rgba(255,255,255,0.05);">
                      <p style="color: #475569; margin: 0; font-size: 12px; line-height: 1.8; text-align: center;">
                        🛡️ إذا لم تقم بإنشاء هذا الحساب، يرجى تجاهل هذا البريد الإلكتروني.
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- Premium Footer -->
                <tr>
                  <td style="background: linear-gradient(180deg, rgba(6,182,212,0.05) 0%, rgba(6,182,212,0.02) 100%); padding: 35px 40px; text-align: center; border-top: 1px solid rgba(6,182,212,0.1);">
                    
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                      <tr>
                        <td width="33%" style="text-align: center; padding: 10px;">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🚀</div>
                          <div style="color: #94a3b8; font-size: 11px;">سرعة فائقة</div>
                        </td>
                        <td width="33%" style="text-align: center; padding: 10px; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05);">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">🔒</div>
                          <div style="color: #94a3b8; font-size: 11px;">أمان متقدم</div>
                        </td>
                        <td width="33%" style="text-align: center; padding: 10px;">
                          <div style="color: #06B6D4; font-size: 20px; margin-bottom: 5px;">💎</div>
                          <div style="color: #94a3b8; font-size: 11px;">جودة عالية</div>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="color: #475569; margin: 0 0 15px 0; font-size: 13px;">
                      <span style="color: #06B6D4;">كون</span> — شريكك في النجاح الرقمي
                    </p>
                    
                    <p style="color: #334155; margin: 0; font-size: 11px;">
                      © ${new Date().getFullYear()} Koun Platform. جميع الحقوق محفوظة.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #334155; margin: 30px 0 0 0; font-size: 11px; text-align: center;">
                تم الإرسال بواسطة منصة كون للتجارة الإلكترونية
              </p>
              
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Standard store template for SMTP
    const storeTemplateSMTP = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #f8fafc;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <!-- Header with Logo -->
                <tr>
                  <td style="background: linear-gradient(135deg, #1E293B 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
                    ${brandLogo ? `<img src="${brandLogo}" alt="${brandName} Logo" style="max-width: 150px; height: auto; margin-bottom: 10px; border-radius: 8px;" />` : ''}
                    <h1 style="color: #ffffff; margin: 10px 0 0 0; font-size: 24px; font-weight: 700;">${brandName}</h1>
                    <p style="color: #06B6D4; margin: 5px 0 0 0; font-size: 14px; font-weight: 500;">منصتك للتجارة الإلكترونية</p>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #1E293B; margin: 0 0 20px 0; font-size: 24px; font-weight: 700; text-align: right;">
                      مرحباً بك في ${brandName}! 🎉
                    </h2>
                    
                    <p style="color: #475569; margin: 0 0 25px 0; font-size: 16px; line-height: 1.6; text-align: right;">
                      نشكرك على التسجيل. استخدم الرمز التالي لتأكيد حسابك:
                    </p>
                    
                    <!-- Verification Code Box -->
                    <div style="background: linear-gradient(135deg, #06B6D4 0%, #0891b2 100%); border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0;">
                      <p style="color: #ffffff; margin: 0 0 10px 0; font-size: 14px; font-weight: 600; letter-spacing: 1px;">
                        رمز التحقق
                      </p>
                      <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; margin: 15px auto; display: inline-block;">
                        <p style="color: #1E293B; margin: 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                          ${code}
                        </p>
                      </div>
                      <p style="color: #ffffff; margin: 15px 0 0 0; font-size: 13px; opacity: 0.9;">
                        صالح لمدة 15 دقيقة
                      </p>
                    </div>
                    
                    <p style="color: #64748b; margin: 25px 0 0 0; font-size: 14px; line-height: 1.6; text-align: right;">
                      إذا لم تقم بإنشاء حساب، يرجى تجاهل هذا البريد الإلكتروني.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f1f5f9; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="color: #64748b; margin: 0 0 10px 0; font-size: 13px;">
                      <strong style="color: #1E293B;">${brandName}</strong> - منصتك الشاملة للتجارة الإلكترونية
                    </p>
                    <p style="color: #94a3b8; margin: 0; font-size: 12px;">
                      © ${new Date().getFullYear()} ${brandName}. جميع الحقوق محفوظة.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Choose template based on branding
    const htmlTemplate = isKounPlatformEmailSMTP ? kounPremiumTemplateSMTP : storeTemplateSMTP;
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: `رمز التحقق - ${brandName}`,
      html: htmlTemplate,
    };

    try {
      this.logger.log(`📧 ========================================`);
      this.logger.log(`📧 SENDING VERIFICATION EMAIL VIA SMTP`);
      this.logger.log(`📧 Recipient: ${email}`);
      this.logger.log(`📧 Verification Code: ${code}`);
      this.logger.log(`📧 Service: ${this.isTestAccount ? 'Ethereal Test (preview only)' : 'Real SMTP (Gmail)'}`);
      this.logger.log(`📧 Brand: ${brandName}`);
      this.logger.log(`📧 ========================================`);
      
      // CPU Safety: Add timeout to prevent hanging and CPU spikes
      const sendEmailWithTimeout = Promise.race([
        this.transporter.sendMail(mailOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email sending timeout')), EMAIL_TIMEOUT_MS)
        )
      ]);
      
      const info: any = await sendEmailWithTimeout;
      this.logger.log(`✅ Email sent! Message ID: ${info.messageId}`);
      
      const previewUrl = nodemailer.getTestMessageUrl(info);
      
      if (previewUrl || this.isTestAccount) {
        this.logger.error(`❌ ========================================`);
        this.logger.error(`❌ ⚠️ USING TEST EMAIL SERVICE (Ethereal.email)`);
        this.logger.error(`❌ ⚠️ EMAIL WAS NOT SENT TO REAL INBOX: ${email}`);
        this.logger.error(`❌ Verification Code: ${code}`);
        this.logger.error(`❌ Preview URL: ${previewUrl || 'N/A'}`);
        this.logger.error(`❌ ========================================`);
        
        if (previewUrl) {
          this.logger.warn(`🔗 Preview URL (emails don't go to real inbox): ${previewUrl}`);
        }
      } else {
        this.logger.log(`✅ ========================================`);
        this.logger.log(`✅ EMAIL SENT TO REAL INBOX: ${email}`);
        this.logger.log(`✅ User should check their Gmail inbox for code: ${code}`);
        this.logger.log(`✅ ========================================`);
      }
      
      return {
        messageId: info.messageId || 'test',
        previewUrl: previewUrl || '',
        isTestEmail: this.isTestAccount,
        code, // Return code for development convenience
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to send verification email to ${email}:`, error);
      this.logger.error(`Error details - Code: ${(error as any).code}, Message: ${error.message}`);
      
      if ((error as any).code === 'EAUTH') {
        throw new Error('Email authentication failed. Please check SMTP credentials.');
      } else if ((error as any).code === 'ECONNECTION') {
        throw new Error('Failed to connect to SMTP server. Please check SMTP settings.');
      } else if (error.message === 'Email sending timeout') {
        throw new Error('Email sending timed out. The SMTP server is too slow or unreachable.');
      }
      
      // Check for invalid email address error
      if (error.message && (error.message.includes('Invalid login') || error.message.includes('Username and Password not accepted'))) {
        throw new Error('SMTP Authentication failed. Please check your email and password.');
      }
      
      // Check for recipient errors
      if (error.response && (error.response.includes('550') || error.response.includes('does not exist'))) {
        const errorMsg = `Invalid email address: ${email}`;
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      // In development, don't throw - let the code be displayed
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(`⚠️ Development mode: Verification code is ${code} (email sending failed: ${error.message})`);
        return {
          messageId: 'test',
          previewUrl: '',
          isTestEmail: true,
          code,
        };
      }
      throw new Error(`Failed to send verification email: ${error.message || String(error)}`);
    }
  }

  async sendEmail(to: string, subject: string, html: string, text?: string, fromNameOverride?: string, tenantId?: string): Promise<{ messageId: string; previewUrl: string }> {
    // If RESEND_API_KEY is configured, prefer Resend over SMTP
    if (this.useResend || process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // For Resend, use onboarding@resend.dev as safe default (works without domain verification)
      // Don't fall back to SMTP_USER which might be a Gmail address that Resend rejects
      const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
      let fromName = fromNameOverride || process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || (process.env.PLATFORM_NAME || 'Saeaa');
      
      if (!fromNameOverride && tenantId && tenantId !== 'default' && tenantId !== 'system') {
        try {
          const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true }
          });
          if (tenant?.name) fromName = tenant.name;
        } catch (e) {}
      }

      try {
        const result: any = await (resend as any).emails.send({
          from: `${fromName} <${fromEmail}>`,
          to,
          subject,
          html,
          text: text || html.replace(/<[^>]*>/g, ''),
        });
        const messageId = result?.id || result?.data?.id || 'resend';
        if (result.error) throw new Error(result.error.message || 'Unknown Resend error');
        
        this.logger.log(`Email sent via Resend to ${to}, Message ID: ${messageId}`);
        return { messageId, previewUrl: '' };
      } catch (error: any) {
        this.logger.error(`Failed to send email via Resend to ${to}: ${error.message || error}`);
        this.logger.warn('⚠️ Falling back to SMTP...');
        // Fall through to SMTP logic below
      }
    }

    // Ensure transporter is initialized (SMTP / test account path)
    await this.initializationPromise;
    
    // CPU Safety: Add timeout protection
    const EMAIL_TIMEOUT_MS = 10000; // 10 seconds max

    let fromEmail: string;
    let fromName: string = fromNameOverride || '';
    
    if (!fromName && tenantId && tenantId !== 'default' && tenantId !== 'system') {
        try {
          const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true }
          });
          if (tenant?.name) fromName = tenant.name;
        } catch (e) {}
    }
    
    if (this.isTestAccount && this.testAccountCredentials) {
      fromEmail = this.testAccountCredentials.user;
      fromName = fromName || process.env.SMTP_FROM_NAME || `${process.env.PLATFORM_NAME || 'Saeaa'} (Test)`;
    } else {
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || (process.env.PLATFORM_EMAIL || 'noreply@kounworld.com');
      fromName = fromName || process.env.SMTP_FROM_NAME || (process.env.PLATFORM_NAME || 'Saeaa');
    }
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
    };

    try {
      this.logger.log(`📧 Sending email to ${to} (Subject: ${subject})...`);
      
      // CPU Safety: Add timeout to prevent hanging
      const sendEmailWithTimeout = Promise.race([
        this.transporter.sendMail(mailOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email sending timeout')), EMAIL_TIMEOUT_MS)
        )
      ]);
      
      const info: any = await sendEmailWithTimeout;
      this.logger.log(`✅ Email sent successfully to ${to}, Message ID: ${info.messageId}`);
      
      if (this.isTestAccount) {
        this.logger.warn(`🔗 Test email preview: ${nodemailer.getTestMessageUrl(info)}`);
      }
      
      return {
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info) || ''
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to send email to ${to}: ${error.message || error}`);
      
      // Provide actionable feedback for common SMTP errors
      if ((error as any).code === 'EAUTH') {
        this.logger.error('❌ AUTHENTICATION FAILED: Check SMTP_USER and SMTP_PASS (App Password)');
      } else if ((error as any).code === 'ECONNECTION') {
        this.logger.error('❌ CONNECTION FAILED: Check SMTP_HOST, SMTP_PORT and firewall');
      } else if (error.message === 'Email sending timeout') {
        this.logger.error('❌ TIMEOUT: SMTP server did not respond in time');
      }
      
      throw error;
    }
  }

  async sendInvitationEmail(email: string, inviteUrl: string, tenantId?: string): Promise<boolean> {
    const platformName = process.env.PLATFORM_NAME || 'Koun';
    
    // Fetch tenant branding if tenantId is provided
    let brandName = platformName;
    let storeLogoUrl = '';
    
    // Fetch site config from app-core to get store logo and name
    if (tenantId && tenantId !== 'default' && tenantId !== 'system') {
      try {
        // First get tenant info
        const tenant = await this.prisma.tenant.findFirst({
            where: { OR: [{ id: tenantId }, { subdomain: tenantId }] },
            select: { name: true, subdomain: true }
        });
        
        if (tenant) {
            brandName = tenant.name;
            
            // Try to fetch site config from app-core for store logo
            try {
              const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3002';
              const siteConfigResponse = await firstValueFrom(
                this.httpService.get(`${coreApiUrl}/api/site-config`, {
                  headers: {
                    'X-Tenant-Id': tenantId,
                  },
                  timeout: 5000,
                })
              );
              
              // Handle both wrapped and unwrapped responses
              // Response structure can be: { data: { settings: {...} } } or { settings: {...} }
              const configData = siteConfigResponse?.data?.data || siteConfigResponse?.data || siteConfigResponse;
              
              // Try to get settings from different possible locations
              const settings = configData?.settings || configData?.data?.settings || configData;
              
              if (settings) {
                if (settings.storeName) {
                  brandName = settings.storeName;
                  this.logger.log(`📧 Using store name from site-config: ${brandName}`);
                }
                if (settings.storeLogoUrl) {
                  storeLogoUrl = settings.storeLogoUrl;
                  this.logger.log(`📧 Found store logo for tenant ${tenantId}: ${storeLogoUrl}`);
                } else {
                  this.logger.warn(`⚠️ No storeLogoUrl found in site-config for tenant ${tenantId}. Available keys: ${Object.keys(settings).join(', ')}`);
                }
              } else {
                this.logger.warn(`⚠️ No settings found in site-config response for tenant ${tenantId}. Response structure: ${JSON.stringify(Object.keys(configData || {}))}`);
              }
            } catch (configError: any) {
              this.logger.warn(`Failed to fetch site config for tenant ${tenantId}: ${configError.message}`);
              // Continue with tenant name if site config fetch fails
            }
        } else {
          this.logger.warn(`⚠️ Tenant not found for tenantId: ${tenantId}`);
        }
      } catch (e) {
          this.logger.warn(`Failed to fetch tenant for invite email: ${e}`);
      }
    }

    // Use the inviteUrl as-is if it's already a full URL, otherwise construct it
    const fullInviteUrl = inviteUrl.startsWith('http') ? inviteUrl : inviteUrl;

    const defaultLogoUrl = process.env.EMAIL_LOGO_URL || 
      (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/branding/koun-logo.png` :
      'https://res.cloudinary.com/purplecards/image/upload/v1770750256/branding/saeaa-logo.jpg');

    const logoUrl = storeLogoUrl || defaultLogoUrl;
    
    // Determine if this is a store invitation (not platform/default)
    const isStoreInvitation = tenantId && tenantId !== 'default' && tenantId !== 'system';
    
    this.logger.log(`📧 Email branding: brandName=${brandName}, storeLogoUrl=${storeLogoUrl || 'none'}, logoUrl=${logoUrl || 'none'}, tenantId=${tenantId || 'none'}, isStore=${isStoreInvitation}`);

    // Simple HTML Template for Store Invitation (no Koun branding)
    const htmlTemplate = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Cairo', Arial, sans-serif; background-color: #f8fafc; padding: 20px; margin: 0;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="background: #1E293B; padding: 30px; text-align: center; color: white;">
              ${logoUrl ? `
                <img src="${logoUrl}" alt="${brandName} Logo" style="max-width: 180px; height: auto; margin-bottom: 15px; display: block; margin-left: auto; margin-right: auto; border-radius: 8px;" />
              ` : ''}
              <h1 style="margin: 0; font-size: ${logoUrl ? '24px' : '28px'};">${brandName}</h1>
              <p style="color: #06B6D4; margin-top: 5px; font-size: 14px;">دعوة خاصة</p>
            </div>
            <div style="padding: 40px;">
              <h2 style="text-align: right; color: #1E293B; margin-top: 0;">مرحباً بك!</h2>
              <p style="text-align: right; color: #475569; line-height: 1.6; font-size: 16px;">
                تمت دعوتك للإنضمام إلى متجر <strong>${brandName}</strong>. اضغط على الزر أدناه لإكمال التسجيل.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${fullInviteUrl}" style="background: #06B6D4; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 16px;">قبول الدعوة</a>
              </div>
              <p style="text-align: right; font-size: 12px; color: #94a3b8; word-break: break-all;">
                ${fullInviteUrl}
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    // If Resend is configured, use it first
    if (this.useResend || process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
        const fromName = brandName; // Use store name instead of platform name
        
        const result: any = await (resend as any).emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject: `دعوة للانضمام إلى ${brandName}`,
          html: htmlTemplate,
        });
        
        if (result.error) throw new Error(result.error.message || 'Unknown Resend error');
        this.logger.log(`✅ Invitation email sent via Resend to ${email}`);
        return true;
      } catch (resendError: any) {
        this.logger.error(`❌ Failed to send invitation email via Resend: ${resendError.message}`);
        this.logger.warn('⚠️ Falling back to SMTP...');
        // Fall through to SMTP logic below
      }
    }

    try {
      await this.initializationPromise;
      await this.transporter.sendMail({
        from: `"${brandName}" <${process.env.SMTP_FROM || 'noreply@kounworld.com'}>`,
        to: email,
        subject: `دعوة للانضمام إلى ${brandName}`,
        html: htmlTemplate,
      });
      this.logger.log(`✅ Invitation email sent to ${email}`);
      return true;
    } catch (e) {
      this.logger.error(`❌ Failed to send invitation email: ${e}`);
      return false;
    }
  }
}

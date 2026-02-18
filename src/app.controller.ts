import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { EmailService } from './email/email.service';

@Controller()
export class AppController {
  constructor(private readonly emailService: EmailService) {}

  @Get()
  @SkipThrottle()
  getHealth() {
    return {
      success: true,
      service: 'app-auth',
      status: 'running',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  @SkipThrottle()
  health() {
    return {
      success: true,
      service: 'auth',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/email')
  @SkipThrottle()
  emailHealth() {
    const hasResend = !!process.env.RESEND_API_KEY;
    const hasSmtp = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
    const resendFrom = process.env.RESEND_FROM || 'onboarding@resend.dev';
    const smtpUser = process.env.SMTP_USER || '';
    const smtpHost = process.env.SMTP_HOST || '';
    
    // Mask sensitive information
    const maskedSmtpUser = smtpUser ? (smtpUser.includes('@') 
      ? smtpUser.split('@')[0].substring(0, 3) + '...@' + smtpUser.split('@')[1]
      : smtpUser.substring(0, 3) + '...') : 'NOT SET';
    
    const resendKeyStatus = hasResend 
      ? `SET (starts with ${process.env.RESEND_API_KEY?.substring(0, 5)}...)`
      : 'NOT SET';
    
    return {
      success: true,
      email: {
        resend: {
          configured: hasResend,
          apiKey: resendKeyStatus,
          fromEmail: resendFrom,
          note: resendFrom === 'onboarding@resend.dev' 
            ? '⚠️ Using default Resend email. This ONLY works for sending to your verified email address.'
            : '✅ Using custom Resend sender email',
        },
        smtp: {
          configured: hasSmtp,
          user: maskedSmtpUser,
          host: smtpHost || 'NOT SET',
          port: process.env.SMTP_PORT || 'NOT SET',
          note: hasSmtp 
            ? '✅ SMTP credentials configured'
            : '⚠️ SMTP credentials NOT configured',
        },
        status: hasResend || hasSmtp 
          ? '✅ Email service configured (at least one method available)'
          : '❌ Email service NOT configured (both Resend and SMTP are missing)',
        recommendation: !hasResend && !hasSmtp
          ? 'Configure either RESEND_API_KEY or SMTP_USER + SMTP_PASS environment variables'
          : !hasResend
          ? 'Consider adding RESEND_API_KEY for better email delivery'
          : !hasSmtp
          ? 'Consider adding SMTP credentials as fallback'
          : '✅ Both Resend and SMTP configured - good redundancy',
      },
      timestamp: new Date().toISOString(),
    };
  }
}


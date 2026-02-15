import { Controller, Get, Post, Body, UseGuards, Request, Query, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { SiteConfigService } from './site-config.service';
import { Public } from '../auth/public.decorator';
import { AuthenticatedRequest } from '../types/request.types';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AppBuilderService } from '../app-builder/app-builder.service';

/**
 * API for per‑tenant site configuration (header, background, language, payments).
 * All endpoints are tenant‑aware – the TenantMiddleware sets `req.tenantId`.
 */
@UseGuards(JwtAuthGuard) // only authenticated users can modify config
@Controller('site-config')
export class SiteConfigController {
  private readonly logger = new Logger(SiteConfigController.name);

  constructor(
    private readonly configService: SiteConfigService,
    private readonly httpService: HttpService,
    private readonly appBuilderService: AppBuilderService,
  ) {}

  /** Get the current configuration for the tenant */
  @Public()
  @Get()
  async getConfig(@Request() req: any, @Query('themeId') themeId?: string) {
    let tenantId = req.tenantId;

    // Fallback: If authenticated but no tenantId in token/header, check user's record
    if (!tenantId && req.user?.id) {
      const userTenantId = await this.configService.getTenantIdByUserId(req.user.id);
      if (userTenantId) {
        tenantId = userTenantId;
      }
    }

    // If still no tenantId, use default
    if (!tenantId) {
      tenantId = 'default';
    }

    return this.configService.getConfig(tenantId, themeId);
  }

  /** Update (or create) the configuration for the tenant */
  @Post()
  @UseGuards(TenantRequiredGuard)
  async upsertConfig(@Request() req: AuthenticatedRequest, @Body() data: any) {
    try {
      // TenantRequiredGuard should have already validated tenantId
      const tenantId = req.user?.tenantId || req.tenantId;
      
      if (!tenantId || tenantId === 'default' || tenantId === 'system') {
        this.logger.error('Site config update failed: Invalid tenantId', {
          tenantId,
          hasUserTenantId: !!req.user?.tenantId,
          hasReqTenantId: !!req.tenantId,
        });
        throw new ForbiddenException(
          'You must set up a market first before updating site configuration. Please go to Market Setup to create your store.'
        );
      }

      this.logger.log(`Updating site config for tenant: ${tenantId}`);
      const accessToken = req.headers.authorization?.replace('Bearer ', '') || '';
      return await this.configService.upsertConfig(tenantId, data, accessToken);
    } catch (error: any) {
      this.logger.error('Error updating site config:', error);
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update site configuration: ${error?.message || 'Unknown error'}`);
    }
  }

  /** Update mobile configuration */
  @Post('mobile')
  @UseGuards(TenantRequiredGuard)
  async updateMobileConfig(@Request() req: AuthenticatedRequest, @Body() data: any) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!tenantId) {
        throw new BadRequestException('Tenant ID is required');
      }
      
      this.logger.log(`Updating mobile config for tenant: ${tenantId}`);
      // AppBuilder expects the config to be in data.config or just data
      const config = data.config || data;
      return await this.appBuilderService.saveConfig(tenantId, config);
    } catch (error: any) {
      this.logger.error('Error updating mobile config:', error);
      throw new BadRequestException(`Failed to update mobile configuration: ${error?.message || 'Unknown error'}`);
    }
  }

  /** Get mobile configuration */
  @Public()
  @Get('mobile')
  async getMobileConfig(@Request() req: any, @Query('tenantId') queryTenantId?: string) {
    // Tenant from middleware OR query param (for preview)
    const tenantId = queryTenantId || req.tenantId || 'default';
    
    if (tenantId === 'default') {
      return {};
    }

    this.logger.log(`Fetching mobile config for tenant: ${tenantId}`);
    const config = await this.appBuilderService.getConfig(tenantId);
    return config || {};
  }

  /** Send contact email to store support */
  @Public()
  @Post('contact')
  async sendContactEmail(@Request() req: any, @Body() data: { name: string; email: string; subject: string; message: string }) {
    try {
      let tenantId = req.tenantId;

      // Fallback: If authenticated but no tenantId in token/header, check user's record
      if (!tenantId && req.user?.id) {
        const userTenantId = await this.configService.getTenantIdByUserId(req.user.id);
        if (userTenantId) {
          tenantId = userTenantId;
        }
      }

      // If still no tenantId, use default
      if (!tenantId) {
        tenantId = 'default';
      }

      // Get store config to find support email
      const config = await this.configService.getConfig(tenantId);
      const storeEmail = (config?.settings as any)?.email || '';

      if (!storeEmail) {
        throw new BadRequestException('Store support email is not configured. Please contact the store administrator.');
      }

      // Validate input
      if (!data.name || !data.email || !data.message) {
        throw new BadRequestException('Name, email, and message are required');
      }

      // Send email via auth service
      const authServiceUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
      const emailUrl = `${authServiceUrl}/email/contact`;

      try {
        await firstValueFrom(
          this.httpService.post(emailUrl, {
            to: storeEmail,
            from: data.email,
            fromName: data.name,
            subject: data.subject || `Contact Form: ${data.name}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">New Contact Form Submission</h2>
                <p><strong>From:</strong> ${data.name} (${data.email})</p>
                <p><strong>Subject:</strong> ${data.subject || 'No subject'}</p>
                <hr style="border: 1px solid #eee; margin: 20px 0;">
                <div style="background: #f9f9f9; padding: 15px; border-radius: 5px;">
                  <p style="white-space: pre-wrap; margin: 0;">${data.message}</p>
                </div>
              </div>
            `,
            text: `
New Contact Form Submission

From: ${data.name} (${data.email})
Subject: ${data.subject || 'No subject'}

Message:
${data.message}
            `,
          })
        );

        return {
          success: true,
          message: 'Your message has been sent successfully. We will get back to you soon.',
        };
      } catch (emailError: any) {
        this.logger.error('Failed to send contact email:', emailError);
        throw new BadRequestException('Failed to send email. Please try again later.');
      }
    } catch (error: any) {
      this.logger.error('Error sending contact email:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to send contact email: ${error?.message || 'Unknown error'}`);
    }
  }
}

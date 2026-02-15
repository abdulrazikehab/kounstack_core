import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Logger,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MasterAdminService } from './master-admin.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { validateFileSafety } from '../utils/file-validation.util';
import { PlanType, Status, TicketStatus, TicketPriority, TransactionStatus } from '@prisma/client';
import { CreateComplaintDto, UpdateComplaintDto } from './dto/complaint.dto';

import { AdminApiKeyGuard } from '../guard/admin-api-key.guard';
import { ApiKeyService } from '../api-key/api-key.service';
import { CreateApiKeyDto } from '../api-key/dto/create-api-key.dto';
import { UpdateApiKeyDto } from '../api-key/dto/update-api-key.dto';

@UseGuards(AdminApiKeyGuard)
@Controller('admin/master')
export class MasterAdminController {
  private readonly logger = new Logger(MasterAdminController.name);

  constructor(
    private readonly masterAdminService: MasterAdminService,
    private readonly apiKeyService: ApiKeyService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ==================== PLATFORM OVERVIEW ====================

  @Get('overview')
  async getPlatformOverview() {
    return this.masterAdminService.getPlatformOverview();
  }

  @Get('system-health')
  async getSystemHealth() {
    return this.masterAdminService.getSystemHealth();
  }

  @Get('stats')
  async getPlatformStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.masterAdminService.getPlatformStats(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  // ==================== TENANT MANAGEMENT ====================

  @Get('tenants')
  async getAllTenants(
    @Query('plan') plan?: PlanType,
    @Query('status') status?: Status,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.masterAdminService.getAllTenants({
      plan,
      status,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('tenants/:id')
  async getTenantById(@Param('id') id: string) {
    return this.masterAdminService.getTenantById(id);
  }

  @Post('tenants')
  async createTenant(
    @Body()
    data: {
      name: string;
      subdomain: string;
      plan?: PlanType;
      description?: string;
      ownerEmail: string;
      ownerPassword: string;
    },
  ) {
    return this.masterAdminService.createTenant(data);
  }

  @Put('tenants/:id')
  async updateTenant(
    @Param('id') id: string,
    @Body()
    data: {
      name?: string;
      nameAr?: string;
      subdomain?: string;
      plan?: PlanType;
      status?: Status;
      description?: string;
      descriptionAr?: string;
      settings?: any;
    },
  ) {
    return this.masterAdminService.updateTenant(id, data);
  }

  @Post('tenants/:id/suspend')
  async suspendTenant(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.masterAdminService.suspendTenant(id, reason);
  }

  @Post('tenants/:id/activate')
  async activateTenant(@Param('id') id: string) {
    return this.masterAdminService.activateTenant(id);
  }

  @Delete('tenants/:id')
  async deleteTenant(@Param('id') id: string) {
    try {
      return await this.masterAdminService.deleteTenant(id);
    } catch (error: any) {
      this.logger.error(`Error deleting tenant ${id}:`, error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete tenant: ${error?.message || 'Unknown error'}`);
    }
  }

  @Post('tenants/:id/change-plan')
  async changeTenantPlan(
    @Param('id') id: string,
    @Body('plan') plan: PlanType,
  ) {
    return this.masterAdminService.changeTenantPlan(id, plan);
  }

  // ==================== PAYMENT GATEWAY MANAGEMENT ====================

  @Get('payment-gateways')
  async getPaymentGateways(@Query('tenantId') tenantId?: string) {
    return this.masterAdminService.getPaymentGateways(tenantId);
  }

  @Post('payment-gateways')
  async createPaymentGateway(
    @Body()
    data: {
      tenantId?: string | null;
      provider: string;
      name: string;
      credentials?: any;
      settings?: any;
    },
  ) {
    return this.masterAdminService.createPaymentGateway(data);
  }

  @Put('payment-gateways/:id')
  async updatePaymentGateway(
    @Param('id') id: string,
    @Body()
    data: {
      name?: string;
      credentials?: any;
      settings?: any;
      isActive?: boolean;
    },
  ) {
    return this.masterAdminService.updatePaymentGateway(id, data);
  }

  @Post('payment-gateways/:id/toggle')
  async togglePaymentGateway(@Param('id') id: string) {
    return this.masterAdminService.togglePaymentGateway(id);
  }

  @Delete('payment-gateways/:id')
  async deletePaymentGateway(@Param('id') id: string) {
    return this.masterAdminService.deletePaymentGateway(id);
  }

  @Get('payment-gateways/:id/stats')
  async getPaymentGatewayStats(@Param('id') id: string) {
    return this.masterAdminService.getPaymentGatewayStats(id);
  }

  // ==================== PARTNER MANAGEMENT ====================

  @Get('partners')
  async getAllPartners(
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.masterAdminService.getAllPartners({
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search,
    });
  }

  @Get('partners/:id(*)')
  async getPartnerById(@Param('id') id: string) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.masterAdminService.getPartnerById(decodedId);
    } catch (error: any) {
      this.logger.error('Error getting partner:', error);
      throw new BadRequestException(`Failed to get partner: ${error?.message || 'Unknown error'}`);
    }
  }

  @Post('partners')
  async createPartner(
    @Body()
    data: {
      name: string;
      nameAr: string;
      email: string;
      phone: string;
      commissionType: 'PERCENTAGE' | 'FIXED';
      commissionValue: number;
      contactPerson?: string;
      settings?: any;
    },
  ) {
    return this.masterAdminService.createPartner(data);
  }

  @Put('partners/:id(*)')
  async updatePartner(
    @Param('id') id: string,
    @Body()
    data: {
      name?: string;
      nameAr?: string;
      email?: string;
      phone?: string;
      commissionType?: 'PERCENTAGE' | 'FIXED';
      commissionValue?: number;
      contactPerson?: string;
      settings?: any;
      isActive?: boolean;
    },
  ) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.masterAdminService.updatePartner(decodedId, data);
    } catch (error: any) {
      this.logger.error('Error updating partner:', error);
      throw new BadRequestException(`Failed to update partner: ${error?.message || 'Unknown error'}`);
    }
  }

  @Delete('partners/:id(*)')
  async deletePartner(@Param('id') id: string) {
    try {
      // Decode the ID in case it was URL-encoded
      const decodedId = decodeURIComponent(id);
      return this.masterAdminService.deletePartner(decodedId);
    } catch (error: any) {
      this.logger.error('Error deleting partner:', error);
      throw new BadRequestException(`Failed to delete partner: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get('partners/:id(*)/stats')
  async getPartnerStats(@Param('id') id: string) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.masterAdminService.getPartnerStats(decodedId);
    } catch (error: any) {
      this.logger.error('Error getting partner stats:', error);
      throw new BadRequestException(`Failed to get partner stats: ${error?.message || 'Unknown error'}`);
    }
  }

  // ==================== SECURITY EVENTS ====================

  @Get('security-events')
  async getSecurityEvents(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.masterAdminService.getSecurityEvents({
      userId,
      action,
      resource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // ==================== AUDIT LOGS ====================

  @Get('audit-logs')
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.masterAdminService.getAuditLogs({
      userId,
      action,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // ==================== ERROR LOGS ====================

  @Get('error-logs')
  async getErrorLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.masterAdminService.getErrorLogs({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // ==================== LIMITS CONFIGURATION ====================

  @Get('limits-config')
  async getLimitsConfig() {
    return this.masterAdminService.getLimitsConfig();
  }

  @Post('limits-config')
  async updateLimitsConfig(@Body() data: {
    signupEnabled?: boolean;
    signinEnabled?: boolean;
    signupMaxAttempts?: number;
    signupWindowMs?: number;
    signinMaxAttempts?: number;
    signinWindowMs?: number;
    maxStoresPerUser?: number;
  }) {
    return this.masterAdminService.updateLimitsConfig(data);
  }

  // ==================== PLANS MANAGEMENT ====================

  @Get('plans')
  async getAllPlans() {
    return this.masterAdminService.getAllPlans();
  }

  @Post('plans')
  async createPlan(@Body() data: any) {
    return this.masterAdminService.createPlan(data);
  }

  @Put('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() data: any) {
    return this.masterAdminService.updatePlan(id, data);
  }

  @Post('plans/:id/toggle')
  async togglePlan(@Param('id') id: string) {
    return this.masterAdminService.togglePlan(id);
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id') id: string) {
    return this.masterAdminService.deletePlan(id);
  }

  // ==================== FEATURE CONTROL ====================

  @Get('features')
  async getAllFeatures() {
    return this.masterAdminService.getAllFeatures();
  }

  @Post('features')
  async createFeature(@Body() data: any) {
    return this.masterAdminService.createFeature(data);
  }

  @Put('features/:id')
  async updateFeature(@Param('id') id: string, @Body() data: any) {
    return this.masterAdminService.updateFeature(id, data);
  }

  @Post('features/:id/toggle')
  async toggleFeature(@Param('id') id: string) {
    return this.masterAdminService.toggleFeature(id);
  }

  @Get('feature-overrides')
  async getFeatureOverrides() {
    return this.masterAdminService.getFeatureOverrides();
  }

  @Post('feature-overrides')
  async createFeatureOverride(@Body() data: any) {
    return this.masterAdminService.createFeatureOverride(data);
  }

  @Delete('feature-overrides/:id')
  async deleteFeatureOverride(@Param('id') id: string) {
    return this.masterAdminService.deleteFeatureOverride(id);
  }

  // ==================== USER GIFTS ====================

  @Get('gifts')
  async getAllGifts() {
    return this.masterAdminService.getAllGifts();
  }

  @Post('gifts')
  async grantGift(@Body() data: any) {
    return this.masterAdminService.grantGift(data);
  }

  @Post('gifts/:id/revoke')
  async revokeGift(@Param('id') id: string) {
    return this.masterAdminService.revokeGift(id);
  }

  @Get('users')
  async getAllUsers(@Query('limit') limit?: string) {
    return this.masterAdminService.getAllUsers(limit ? parseInt(limit) : undefined);
  }

  // ==================== CUSTOMER MANAGEMENT ====================

  @Get('customers')
  async getCustomers() {
    return this.masterAdminService.getCustomers();
  }

  // ==================== AI CONFIGURATION ====================

  @Get('ai-script')
  async getGlobalAiScript() {
    return this.masterAdminService.getGlobalAiScript();
  }

  @Post('ai-script')
  async updateGlobalAiScript(@Body() data: { script: string }) {
    try {
      if (data === undefined || data === null) {
        throw new BadRequestException('Request body is required');
      }
      const script = data.script || '';
      return this.masterAdminService.updateGlobalAiScript(script);
    } catch (error: any) {
      this.logger.error('Error updating AI script:', error);
      throw new BadRequestException(`Failed to update AI script: ${error?.message || 'Unknown error'}`);
    }
  }

  // ==================== DATABASE MANAGEMENT ====================

  @Post('reset-database')
  async resetDatabase() {
    return this.masterAdminService.resetDatabase();
  }

  @Post('clear-non-transaction-data')
  async clearNonTransactionData() {
    return this.masterAdminService.clearNonTransactionData();
  }

  // ==================== API KEY MANAGEMENT ====================

  @Get('api-keys')
  async getAllApiKeys(@Query('tenantId') tenantId?: string) {
    try {
      if (tenantId) {
        const apiKeys = await this.apiKeyService.findAll(tenantId);
        return { apiKeys };
      }
      
      // Get all API keys from all tenants
      const allApiKeys = await this.apiKeyService.findAllForAllTenants();
      return { apiKeys: allApiKeys || [] };
    } catch (error: any) {
      // Log the full error for debugging
      console.error('Error in getAllApiKeys:', error);
      console.error('Error details:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        stack: error?.stack,
      });
      throw new BadRequestException(
        `Failed to fetch API keys: ${error?.message || 'Unknown error'}. ` +
        `Please check server logs for details. Code: ${error?.code || 'N/A'}`
      );
    }
  }

  @Post('api-keys')
  async createApiKey(@Body() dto: CreateApiKeyDto) {
    try {
      // Log the incoming request for debugging
      this.logger.log(`Creating API key with name: ${dto?.name}`);
      
      // Create API key without requiring tenantId - uses system tenant automatically
      // This allows creating API keys for tracking API usage globally
      if (!dto || !dto.name || !dto.name.trim()) {
        throw new BadRequestException('API key name is required');
      }
      
      const result = await this.apiKeyService.create(null, { name: dto.name.trim() });
      this.logger.log(`API key created successfully: ${result.id}`);
      return result;
    } catch (error: any) {
      // Log the full error for debugging
      this.logger.error('Error in createApiKey:', error);
      this.logger.error('Error details:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
        stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
      });
      this.logger.error('DTO received:', JSON.stringify(dto));
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Handle Prisma errors
      if (error?.code) {
        if (error.code === 'P2002') {
          const target = error?.meta?.target || 'field';
          throw new BadRequestException(`API key with this ${target} already exists`);
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid tenant reference. Please check system configuration.');
        }
      }
      
      throw new BadRequestException(`Failed to create API key: ${error?.message || 'Unknown error'}`);
    }
  }

  @Post('api-keys/create-koun')
  async createKounApiKey() {
    try {
      // Check if koun API key already exists
      const existingKeys = await this.apiKeyService.findAllForAllTenants();
      const existingKoun = existingKeys.find(k => k.name.toLowerCase() === 'koun');
      
      if (existingKoun) {
        return {
          success: true,
          message: 'Koun API key already exists',
          apiKey: {
            ...existingKoun,
            key: '********************' // Hide key for security
          }
        };
      }
      
      this.logger.log('Creating Koun API key...');
      
      // Create the koun API key (uses system tenant automatically)
      const result = await this.apiKeyService.create(null, { name: 'koun' });
      return {
        success: true,
        message: 'API key "koun" created successfully',
        apiKey: result.apiKey,
        id: result.id,
        name: result.name,
        warning: 'Please save the API key now - it will not be shown again!'
      };
    } catch (error: any) {
      throw new BadRequestException(`Failed to create koun API key: ${error.message}`);
    }
  }

  @Get('api-keys/:id(*)')
  async getApiKey(@Param('id') id: string) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.apiKeyService.findOneForAdmin(decodedId);
    } catch (error: any) {
      this.logger.error('Error getting API key:', error);
      throw new BadRequestException(`Failed to get API key: ${error?.message || 'Unknown error'}`);
    }
  }

  @Put('api-keys/:id(*)')
  async updateApiKey(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    try {
      // Decode the ID in case it was URL-encoded
      const decodedId = decodeURIComponent(id);
      return this.apiKeyService.updateForAdmin(decodedId, dto);
    } catch (error: any) {
      this.logger.error('Error updating API key:', error);
      throw new BadRequestException(`Failed to update API key: ${error?.message || 'Unknown error'}`);
    }
  }

  @Delete('api-keys/:id(*)')
  async deleteApiKey(@Param('id') id: string) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.apiKeyService.removeForAdmin(decodedId);
    } catch (error: any) {
      this.logger.error('Error deleting API key:', error);
      throw new BadRequestException(`Failed to delete API key: ${error?.message || 'Unknown error'}`);
    }
  }

  @Post('api-keys/:id(*)/regenerate')
  async regenerateApiKey(@Param('id') id: string) {
    try {
      const decodedId = decodeURIComponent(id);
      return this.apiKeyService.regenerateForAdmin(decodedId);
    } catch (error: any) {
      this.logger.error('Error regenerating API key:', error);
      throw new BadRequestException(`Failed to regenerate API key: ${error?.message || 'Unknown error'}`);
    }
  }

  // ==================== ADMIN API KEY MANAGEMENT ====================

  @Get('admin-api-key')
  async getAdminApiKey() {
    return this.masterAdminService.getAdminApiKey();
  }

  @Post('admin-api-key')
  async setAdminApiKey(@Body() data: { apiKey: string }) {
    // SECURITY FIX: Validate API key strength
    if (!data.apiKey || typeof data.apiKey !== 'string') {
      throw new BadRequestException('API key must be a non-empty string');
    }
    
    const trimmedKey = data.apiKey.trim();
    
    if (trimmedKey.length < 20) {
      throw new BadRequestException('API key must be at least 20 characters long');
    }
    
    // SECURITY FIX: Reject default/weak keys
    if (trimmedKey === 'Koun2025Admin!' || trimmedKey === 'Kawn2025Admin!' || trimmedKey === 'Saeaa2025Admin!' || trimmedKey === 'fallback-secret') {
      throw new BadRequestException('Cannot use default or insecure API key. Please choose a strong, unique key.');
    }
    
    // SECURITY FIX: Log API key update for audit
    this.logger.warn(`Admin API key updated by admin. New key length: ${trimmedKey.length}`);
    
    return this.masterAdminService.setAdminApiKey(trimmedKey);
  }

  // ==================== PAGE CONTENT MANAGEMENT ====================

  @Put('pages/:slug')
  async updatePageContent(
    @Param('slug') slug: string,
    @Body() content: any,
  ) {
    return this.masterAdminService.updatePageContent(slug, content);
  }

  // ==================== PLATFORM CONFIGURATION ====================

  @Get('platform-config')
  async getPlatformConfig() {
    return this.masterAdminService.getPlatformConfig();
  }

  @Post('platform-config')
  async updatePlatformConfig(@Body() data: any) {
    return this.masterAdminService.updatePlatformConfig(data);
  }

  @Post('platform-logo')
  @UseInterceptors(FileInterceptor('logo', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      // Validate file types
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException(`File type ${file.mimetype} is not allowed. Only JPEG, PNG, WebP, and SVG are supported.`), false);
      }
    },
  }))
  async uploadPlatformLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No logo file uploaded');
    }

    // Validate file safety (Magic Numbers)
    validateFileSafety(file);

    this.logger.log('Uploading platform logo');

    try {
      // Upload to Cloudinary in branding folder
      const uploadResult = await this.cloudinaryService.uploadImage(file, 'branding/platform');
      
      // Get current platform config
      const currentConfig = await this.masterAdminService.getPlatformConfig();
      
      // Update platform config with logo URL
      await this.masterAdminService.updatePlatformConfig({
        ...currentConfig,
        logoUrl: uploadResult.secureUrl,
      });

      return {
        message: 'Logo uploaded successfully',
        logoUrl: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
      };
    } catch (error: any) {
      this.logger.error('Failed to upload platform logo:', error);
      throw new BadRequestException(`Failed to upload logo: ${error?.message || 'Unknown error'}`);
    }
  }

  // ==================== CLOUDINARY ACCESS ====================

  @Get('cloudinary-access')
  async getCloudinaryAccessUsers() {
    return this.masterAdminService.getCloudinaryAccessUsers();
  }

  @Post('cloudinary-access')
  async grantCloudinaryAccess(@Body() data: { userIds: string[] }, @Req() req: any) {
    return this.masterAdminService.updateCloudinaryAccess(data.userIds, true, req.user?.id || 'system-admin');
  }

  @Delete('cloudinary-access')
  async revokeCloudinaryAccess(@Body() data: { userIds: string[] }, @Req() req: any) {
    return this.masterAdminService.updateCloudinaryAccess(data.userIds, false, req.user?.id || 'system-admin');
  }

  @Get('users/:userId/cloudinary-access')
  async getUserCloudinaryAccess(@Param('userId') userId: string) {
    return this.masterAdminService.getUserCloudinaryAccess(userId);
  }

  // ==================== COMPLAINTS MANAGEMENT ====================

  @Get('complaints')
  async getAllComplaints(
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.masterAdminService.getAllComplaints({
      status,
      priority,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('complaints/:id')
  async getComplaintById(@Param('id') id: string) {
    return this.masterAdminService.getComplaintById(id);
  }

  @Post('complaints')
  async createComplaint(@Body() data: CreateComplaintDto) {
    return this.masterAdminService.createComplaint(data);
  }

  @Put('complaints/:id')
  async updateComplaint(
    @Param('id') id: string,
    @Body() data: UpdateComplaintDto,
  ) {
    return this.masterAdminService.updateComplaint(id, data);
  }

  @Delete('complaints/:id')
  async deleteComplaint(@Param('id') id: string) {
    return this.masterAdminService.deleteComplaint(id);
  }

  // ==================== TRANSACTION MANAGEMENT ====================

  @Get('transactions')
  async getAllTransactions(
    @Query('status') status?: TransactionStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.masterAdminService.getAllTransactions({
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Post('transactions/:id/refund')
  async refundTransaction(@Param('id') id: string) {
    return this.masterAdminService.refundTransaction(id);
  }

  // ==================== VERSIONS MANAGEMENT ====================

  @Get('versions')
  async getAllVersions() {
    return this.masterAdminService.getAllVersions();
  }

  @Get('versions/:id')
  async getVersionById(@Param('id') id: string) {
    return this.masterAdminService.getVersionById(id);
  }

  @Post('versions')
  async createVersion(
    @Body()
    data: {
      name: string;
      description?: string;
      versionCode: string;
      visibleTabs: string[];
      visibleTenantTabs: string[];
      enabledFeatures: string[];
      isActive?: boolean;
      isDefault?: boolean;
    },
  ) {
    return this.masterAdminService.createVersion(data);
  }

  @Put('versions/:id')
  async updateVersion(
    @Param('id') id: string,
    @Body()
    data: {
      name?: string;
      description?: string;
      versionCode?: string;
      visibleTabs?: string[];
      visibleTenantTabs?: string[];
      enabledFeatures?: string[];
      isActive?: boolean;
      isDefault?: boolean;
    },
  ) {
    return this.masterAdminService.updateVersion(id, data);
  }

  @Delete('versions/:id')
  async deleteVersion(@Param('id') id: string) {
    return this.masterAdminService.deleteVersion(id);
  }
}

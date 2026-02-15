// src/staff/staff.controller.ts
import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query, 
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Request,
  Logger,
  ForbiddenException
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../authentication/guard/jwt-auth.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
import { Roles } from '../authentication/decorators/roles.decorator';

@Controller('auth/staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(private readonly staffService: StaffService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Request() req: any,
    @Body() createStaffDto: any,
  ) {
    return this.staffService.createStaff(
      req.user.tenantId,
      req.user.id,
      createStaffDto
    );
  }

  @Get()
  async getStaffUsers(
    @Request() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
    @Query('tenantId') tenantId?: string,
  ) {
    // Allow admins to query by tenantId, otherwise use user's tenantId
    // Also allow CUSTOMER role to get staff in their tenant
    const isCustomer = req.user?.type === 'customer' || req.user?.role === 'CUSTOMER';
    const targetTenantId = (req.user.role === 'SUPER_ADMIN' && tenantId) 
      ? tenantId 
      : (isCustomer ? req.user.tenantId : req.user.tenantId);
    return this.staffService.getStaffUsers(targetTenantId, page, limit);
  }

  @Get('permissions')
  async getAvailablePermissions() {
    return this.staffService.getAvailablePermissions();
  }

  @Post('send-credentials')
  async sendCredentials(
    @Request() req: any,
    @Body() body: { email: string; password?: string; inviteUrl?: string },
  ) {
    return this.staffService.sendCredentials(
      req.user.tenantId,
      body.email,
      body.password,
      body.inviteUrl
    );
  }

  @Get(':id')
  async getStaffUser(
    @Request() req: any,
    @Param('id') staffUserId: string,
  ) {
    return this.staffService.getStaffUser(req.user.tenantId, staffUserId);
  }

  @Put(':id/permissions')
  @UseGuards(RolesGuard)
  @Roles('SHOP_OWNER', 'SUPER_ADMIN')
  async updateStaffPermissions(
    @Request() req: any,
    @Param('id') staffUserId: string,
    @Body() body: { permissions: string[]; tenantId?: string },
  ) {
    // Log full request details for debugging
    this.logger.log(`=== Update permissions request ===`);
    this.logger.log(`User ID: ${req.user?.id}`);
    this.logger.log(`User Role: ${req.user?.role}`);
    this.logger.log(`TenantId from req.user: ${req.user?.tenantId} (type: ${typeof req.user?.tenantId})`);
    this.logger.log(`TenantId from body: ${body.tenantId}`);
    this.logger.log(`Full req.user object: ${JSON.stringify(req.user)}`);
    
    // Get tenantId - use body.tenantId if provided and user is SUPER_ADMIN, otherwise use req.user.tenantId
    let targetTenantId: string | null | undefined = null;
    
    // Normalize tenantId - handle null, undefined, empty string, and 'null'/'undefined' strings
    const userTenantId = req.user?.tenantId;
    const bodyTenantId = body.tenantId;
    
    if (req.user?.role === 'SUPER_ADMIN' && bodyTenantId) {
      targetTenantId = bodyTenantId;
    } else {
      targetTenantId = userTenantId;
    }
    
    // Normalize: convert null/undefined to empty string, trim whitespace
    const normalizedTenantId = targetTenantId ? String(targetTenantId).trim() : '';
    
    this.logger.log(`Normalized tenantId - original: ${targetTenantId}, normalized: "${normalizedTenantId}"`);
    
    // For non-SUPER_ADMIN users, tenantId should be present
    if (!normalizedTenantId && req.user?.role !== 'SUPER_ADMIN') {
      this.logger.error(`❌ No tenantId found for user ${req.user?.id} with role ${req.user?.role}`);
      this.logger.error(`This might be because:`);
      this.logger.error(`1. The JWT token doesn't include tenantId`);
      this.logger.error(`2. The user doesn't have a tenantId in the database`);
      this.logger.error(`3. The user needs to complete tenant setup`);
      throw new ForbiddenException('Tenant ID is required. Please ensure you are logged in with a valid tenant.');
    }
    
    // Pass the normalized tenantId (empty string if null/undefined)
    return this.staffService.updateStaffPermissions(
      normalizedTenantId,
      req.user?.id || req.user?.userId,
      staffUserId,
      body.permissions
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaffUser(
    @Request() req: any,
    @Param('id') staffUserId: string,
  ) {
    return this.staffService.deleteStaffUser(
      req.user.tenantId,
      req.user.id,
      staffUserId
    );
  }
}
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
  Headers,
} from '@nestjs/common';
import { CustomerRegistrationRequestService } from './customer-registration-request.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { CustomerRegistrationRequestStatus } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { TenantService } from '../tenant/tenant.service';

@Controller('customer-registration-requests')
export class CustomerRegistrationRequestController {
  private readonly logger = new Logger(CustomerRegistrationRequestController.name);

  constructor(
    private readonly customerRegistrationRequestService: CustomerRegistrationRequestService,
    private readonly tenantService: TenantService,
  ) {}

  @Public()
  @Post()
  async createRequest(
    @Request() req: any,
    @Headers('x-tenant-domain') tenantDomain: string,
    @Body() body: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      storeName?: string;
      activity?: string;
      companyName?: string;
      city?: string;
      country?: string;
      tenantId?: string;
    },
  ) {
    // Resolve tenant ID from multiple sources
    let tenantId = body.tenantId || req.tenantId || req.headers['x-tenant-id'];
    
    // If still no tenantId, try to resolve from domain/subdomain
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      const hostname = tenantDomain || req.headers['x-tenant-domain'] || req.headers.host || req.headers['x-forwarded-host'] || '';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const domain = hostname ? `${protocol}://${hostname}` : '';
      
      if (domain) {
        try {
          const resolvedTenantId = await this.tenantService.resolveTenantId(domain);
          if (resolvedTenantId && resolvedTenantId !== 'default' && resolvedTenantId !== 'system') {
            tenantId = resolvedTenantId;
          }
        } catch (error) {
          this.logger.warn(`Failed to resolve tenant ID from domain: ${domain}`, error);
        }
      }
    }

    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException('Unable to determine store. Please ensure you are accessing the correct store URL.');
    }

    return this.customerRegistrationRequestService.createRequest(tenantId, {
      email: body.email,
      password: body.password,
      fullName: body.fullName,
      phone: body.phone,
      storeName: body.storeName,
      activity: body.activity,
      companyName: body.companyName,
      city: body.city,
      country: body.country,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getRequests(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: CustomerRegistrationRequestStatus,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.customerRegistrationRequestService.getRequests(tenantId, status);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getRequestById(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.customerRegistrationRequestService.getRequestById(tenantId, id);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approveRequest(
    @Request() req: AuthenticatedRequest, 
    @Param('id') id: string,
    @Headers('authorization') authToken: string,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    return this.customerRegistrationRequestService.approveRequest(tenantId, id, userId, authToken);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard)
  async rejectRequest(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!body.reason) {
      throw new BadRequestException('Rejection reason is required');
    }

    return this.customerRegistrationRequestService.rejectRequest(
      tenantId,
      id,
      userId,
      body.reason,
    );
  }

  @Post(':id/update')
  @UseGuards(JwtAuthGuard)
  async updateRequest(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.customerRegistrationRequestService.updateRequest(tenantId, id, body);
  }
}


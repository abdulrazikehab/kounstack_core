import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerRegistrationRequestStatus } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
// Email service will be added later if needed

@Injectable()
export class CustomerRegistrationRequestService {
  private readonly logger = new Logger(CustomerRegistrationRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  async createRequest(
    tenantId: string,
    data: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      storeName?: string;
      activity?: string;
      companyName?: string;
      city?: string;
      country?: string;
    },
  ) {
    this.logger.log(`Creating registration request for tenant: ${tenantId}, email: ${data.email}`);

    // Check if tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        storeType: true,
        customerRegistrationRequestEnabled: true,
        isPrivateStore: true,
        subdomain: true,
        name: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Allow registration requests if:
    // 1. Private store (isPrivateStore === true), OR
    // 2. B2B store with registration requests enabled
    const isPrivateStore = tenant.isPrivateStore === true;
    const isB2BWithRequests = tenant.storeType === 'B2B' && tenant.customerRegistrationRequestEnabled === true;
    
    if (!isPrivateStore && !isB2BWithRequests) {
      throw new BadRequestException('Customer registration requests are not enabled for this store');
    }

    // Check if the model exists in Prisma client
    if (!this.prisma.customerRegistrationRequest) {
      this.logger.error('CustomerRegistrationRequest model not found in Prisma client. Please run: npx prisma generate');
      throw new BadRequestException('Database model not available. Please restart the server after running Prisma migration.');
    }

    // Check if request already exists
    const existingRequest = await this.prisma.customerRegistrationRequest.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: data.email.toLowerCase().trim(),
        },
      },
    });

    if (existingRequest) {
      if (existingRequest.status === 'PENDING') {
        throw new ConflictException('A registration request with this email is already pending');
      }
      if (existingRequest.status === 'APPROVED') {
        throw new ConflictException('A customer with this email has already been approved');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 12);

    // Generate registration URL token
    const registrationToken = crypto.randomBytes(32).toString('hex');
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    const registrationUrl = `${baseUrl}/register/${registrationToken}`;

    // Create request
    const request = await this.prisma.customerRegistrationRequest.create({
      data: {
        tenantId,
        email: data.email.toLowerCase().trim(),
        password: hashedPassword,
        fullName: data.fullName,
        phone: data.phone,
        storeName: data.storeName,
        activity: data.activity,
        companyName: data.companyName,
        city: data.city,
        country: data.country,
        status: 'PENDING',
        registrationUrl,
      },
    });

    // Send email to store owner (if configured)
    // TODO: Send notification email to store owner

    this.logger.log(`Created registration request ${request.id} for ${data.email}`);

    return {
      id: request.id,
      email: request.email,
      fullName: request.fullName,
      status: request.status,
      message: 'Your registration request has been submitted. You will receive an email once it is reviewed.',
    };
  }

  async getRequests(tenantId: string, status?: CustomerRegistrationRequestStatus) {
    if (!this.prisma) {
      this.logger.error('PrismaService is not initialized');
      throw new BadRequestException('Database service is not available');
    }

    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }

    try {
      // Check if the model exists in Prisma client
      if (!this.prisma.customerRegistrationRequest) {
        // Log available models for debugging
        const availableModels = Object.keys(this.prisma).filter(key => 
          !key.startsWith('$') && typeof this.prisma[key] === 'object' && this.prisma[key] !== null
        );
        this.logger.error(`CustomerRegistrationRequest model not found in Prisma client. Available models: ${availableModels.join(', ')}`);
        this.logger.error('Please stop the server, run: npm run prisma:generate, then restart the server');
        throw new BadRequestException('Database model not available. Please restart the server after running Prisma migration.');
      }

      const requests = await this.prisma.customerRegistrationRequest.findMany({
        where,
        include: {
          processedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return requests;
    } catch (error: any) {
      this.logger.error(`Error fetching registration requests: ${error.message}`, error.stack);
      if (error.message?.includes('customerRegistrationRequest') || error.message?.includes('Cannot read properties')) {
        throw new BadRequestException('Database model not found. Please stop the server, run "npx prisma generate" and "npx prisma migrate dev", then restart the server.');
      }
      throw error;
    }
  }

  async getRequestById(tenantId: string, requestId: string) {
    const request = await this.prisma.customerRegistrationRequest.findFirst({
      where: {
        id: requestId,
        tenantId,
      },
      include: {
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
            isPrivateStore: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Registration request not found');
    }

    return request;
  }

  async approveRequest(tenantId: string, requestId: string, processedByUserId: string, authToken: string) {
    const request = await this.getRequestById(tenantId, requestId);

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);
    }

    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

    try {
      // Create customer in Auth Service
      const isPrivateStore = request.tenant?.isPrivateStore;
      
      const payload: any = {
         email: request.email,
         firstName: request.fullName.split(' ')[0],
         lastName: request.fullName.split(' ').slice(1).join(' '),
         phone: request.phone,
         role: 'CUSTOMER',
         isEmailVerified: true,
         metadata: {
            storeName: request.storeName,
            companyName: request.companyName,
            activity: request.activity,
            city: request.city,
            country: request.country,
            source: 'REGISTRATION_REQUEST',
            originalRequestId: request.id
         }
      };

      // Only send password if NOT a private store (or custom logic)
      // For Private Stores, we want to generate an invite link, so we omit the password.
      if (!isPrivateStore) {
        payload.password = request.password;
      }

      // We need to send X-Tenant-Domain forinvite URL generation to work correctly in Auth Service
      const headers: any = {
        'Authorization': authToken,
        'x-tenant-id': tenantId
      };
      
      // Try to reconstruct domain from tenant info if possible, or rely on auth service resolving it from tenantId
      if (request.tenant?.subdomain) {
         // This is a best effort guess, ideally we should pass it from controller
         headers['x-tenant-domain'] = `${request.tenant.subdomain}.localhost`; 
      }

      const { data } = await firstValueFrom(
        this.httpService.post(`${authUrl}/auth/customers`, payload, {
          headers
        })
      );
      
      this.logger.log(`Created customer in auth service: ${data?.data?.id || 'unknown'}`);
      
      const responseData = data?.data || data;

      // Update request status
      await this.prisma.customerRegistrationRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          processedAt: new Date(),
          processedByUserId,
        },
      });

      this.logger.log(`Approved registration request ${requestId} for ${request.email}`);

      return {
        id: request.id,
        email: request.email,
        status: 'APPROVED',
        message: 'Registration request approved and customer account created.',
        inviteUrl: responseData?.inviteUrl, 
        customer: responseData
      };

    } catch (error: any) {
        this.logger.error(`Failed to create customer in auth service: ${error.message}`, error.response?.data);
        // We might want to throw here to prevent approving if creation fails?
        // Or just log it and mark approved, but with a warning?
        // User asked to "insert automatic", so failure should probably block approval.
        throw new BadRequestException(`Failed to create customer: ${error.response?.data?.message || error.message}`);
    }

  }

  async rejectRequest(
    tenantId: string,
    requestId: string,
    processedByUserId: string,
    rejectionReason: string,
  ) {
    const request = await this.getRequestById(tenantId, requestId);

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);
    }

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    // Update request status
    await this.prisma.customerRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        processedAt: new Date(),
        processedByUserId,
        rejectionReason: rejectionReason.trim(),
      },
    });

    // Send rejection email to customer
    // TODO: Send rejection email

    this.logger.log(`Rejected registration request ${requestId} for ${request.email}`);

    return {
      id: request.id,
      email: request.email,
      status: 'REJECTED',
      message: 'Registration request rejected.',
    };
  }
  async updateRequest(
    tenantId: string,
    requestId: string,
    data: Partial<{
      fullName: string;
      phone: string;
      storeName: string;
      activity: string;
      companyName: string;
      city: string;
      country: string;
    }>,
  ) {
    const request = await this.getRequestById(tenantId, requestId);

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()} and cannot be edited`);
    }

    return this.prisma.customerRegistrationRequest.update({
      where: { id: requestId },
      data,
    });
  }
}


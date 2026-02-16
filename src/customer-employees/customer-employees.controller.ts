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
  Request,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CustomerEmployeesService, CreateCustomerEmployeeDto, UpdateCustomerEmployeeDto } from './customer-employees.service';
import { JwtAuthGuard } from '../authentication/guard/jwt-auth.guard';

@Controller('customer-employees')
@UseGuards(JwtAuthGuard)
export class CustomerEmployeesController {
  private readonly logger = new Logger(CustomerEmployeesController.name);

  constructor(private readonly customerEmployeesService: CustomerEmployeesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCustomerEmployee(
    @Request() req: any,
    @Body() createEmployeeDto: CreateCustomerEmployeeDto,
  ) {
    this.logger.log('=== Create Customer Employee Request ===');
    this.logger.log('User:', JSON.stringify({ 
      id: req.user?.id, 
      userId: req.user?.userId,
      sub: req.user?.sub,
      type: req.user?.type, 
      role: req.user?.role,
      tenantId: req.user?.tenantId,
      email: req.user?.email 
    }, null, 2));
    this.logger.log('Body:', JSON.stringify(createEmployeeDto, null, 2));

    // Get customer ID from token - try multiple possible fields
    const customerId = req.user?.id || req.user?.userId || req.user?.sub;
    if (!customerId) {
      this.logger.error('Customer ID not found in token', { user: req.user });
      throw new BadRequestException('Customer ID not found in token. Please make sure you are logged in as a customer.');
    }

    // Verify user is a customer
    const isCustomer = req.user?.type === 'customer' || req.user?.role === 'CUSTOMER';
    if (!isCustomer) {
      this.logger.warn('Non-customer tried to create employee', {
        userType: req.user?.type,
        userRole: req.user?.role
      });
      throw new BadRequestException(`Only customers can create employees. Current user type: ${req.user?.type || req.user?.role || 'unknown'}`);
    }

    // Log tenantId for debugging
    this.logger.log(`Customer ${customerId} creating employee in tenant: ${req.user?.tenantId || 'not set'}`);

    try {
      return await this.customerEmployeesService.createCustomerEmployee(customerId, createEmployeeDto);
    } catch (error: any) {
      this.logger.error('Error creating customer employee:', {
        error: error.message,
        stack: error.stack,
        customerId,
        tenantId: req.user?.tenantId,
      });
      throw error;
    }
  }

  @Get()
  async getCustomerEmployees(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Parse page and limit with defaults
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    try {
      this.logger.log('=== Get Customer Employees Request ===');
      this.logger.log('User:', JSON.stringify({ 
        id: req.user?.id, 
        userId: req.user?.userId,
        sub: req.user?.sub,
        type: req.user?.type, 
        role: req.user?.role,
        tenantId: req.user?.tenantId,
        email: req.user?.email 
      }, null, 2));

      // Get customer ID from token - try multiple possible fields
      const customerId = req.user?.id || req.user?.userId || req.user?.sub;
      
      if (!customerId) {
        this.logger.error('Customer ID not found in token', { user: req.user });
        throw new BadRequestException('Customer ID not found in token. Please make sure you are logged in as a customer.');
      }

      // Verify user is a customer
      const isCustomer = req.user?.type === 'customer' || req.user?.role === 'CUSTOMER';
      if (!isCustomer) {
        this.logger.warn('Non-customer tried to view employees', {
          userType: req.user?.type,
          userRole: req.user?.role
        });
        throw new BadRequestException('Only customers can view their employees');
      }

      return await this.customerEmployeesService.getCustomerEmployees(customerId, pageNum, limitNum);
    } catch (error: any) {
      this.logger.error('Error in getCustomerEmployees controller:', {
        error: error.message,
        stack: error.stack,
        user: req.user,
      });
      
      // Re-throw known exceptions
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      // For unknown errors, throw a generic error
      throw new BadRequestException(error.message || 'Failed to fetch employees');
    }
  }

  @Get('permissions')
  async getAvailablePermissions() {
    return this.customerEmployeesService.getAvailableStorePermissions();
  }

  @Get('store-info')
  async getCustomerStoreInfo(@Request() req: any) {
    try {
      const customerId = req.user?.id || req.user?.userId || req.user?.sub;
      if (!customerId) {
        throw new BadRequestException('Customer ID not found in token');
      }

      const isCustomer = req.user?.type === 'customer' || req.user?.role === 'CUSTOMER';
      if (!isCustomer) {
        throw new BadRequestException('Only customers can view their store info');
      }

      // Get customer with tenant info
      const customer = await this.customerEmployeesService['prismaService'].customer.findUnique({
        where: { id: customerId },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              subdomain: true,
              status: true,
              plan: true,
            },
          },
        },
      });

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      return {
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
        },
        store: customer.tenant ? {
          id: customer.tenant.id,
          name: customer.tenant.name,
          subdomain: customer.tenant.subdomain,
          status: customer.tenant.status,
          plan: customer.tenant.plan,
        } : null,
      };
    } catch (error: any) {
      this.logger.error('Error getting customer store info:', error);
      throw error;
    }
  }

  @Get(':id')
  async getCustomerEmployee(
    @Request() req: any,
    @Param('id') employeeId: string,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new BadRequestException('Customer ID not found in token');
    }

    return this.customerEmployeesService.getCustomerEmployee(customerId, employeeId);
  }

  @Put(':id')
  async updateCustomerEmployee(
    @Request() req: any,
    @Param('id') employeeId: string,
    @Body() body: UpdateCustomerEmployeeDto,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new BadRequestException('Customer ID not found in token');
    }

    return this.customerEmployeesService.updateCustomerEmployee(
      customerId,
      employeeId,
      body
    );
  }

  @Put(':id/permissions')
  async updateCustomerEmployeePermissions(
    @Request() req: any,
    @Param('id') employeeId: string,
    @Body() body: { permissions: string[] },
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new BadRequestException('Customer ID not found in token');
    }

    return this.customerEmployeesService.updateCustomerEmployeePermissions(
      customerId,
      employeeId,
      body.permissions
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteCustomerEmployee(
    @Request() req: any,
    @Param('id') employeeId: string,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new BadRequestException('Customer ID not found in token');
    }

    return this.customerEmployeesService.deleteCustomerEmployee(customerId, employeeId);
  }

  @Post(':id/balance')
  @HttpCode(HttpStatus.OK)
  async addBalance(
    @Request() req: any,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    const customerId = req.user?.id || req.user?.userId || req.user?.sub;
    if (!customerId) {
      throw new BadRequestException('Customer ID not found in token');
    }
    
    if (!amount || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return this.customerEmployeesService.addBalance(customerId, id, amount);
  }

  @Post(':id/change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Request() req: any,
    @Param('id') employeeId: string,
    @Body() changePasswordDto: { currentPassword: string; newPassword: string },
  ) {
    // Verify the employee belongs to the customer making the request (for customer users)
    // Or allow employee to change their own password (for employee users)
    const customerId = req.user?.id || req.user?.customerId;
    const employeeUserId = req.user?.employeeId;

    if (employeeUserId && employeeUserId === employeeId) {
      // Employee changing their own password
      return this.customerEmployeesService.changePassword(employeeId, changePasswordDto.currentPassword, changePasswordDto.newPassword);
    } else if (customerId) {
      // Customer changing employee password - verify employee belongs to customer
      const employee = await this.customerEmployeesService['prismaService'].customerEmployee.findFirst({
        where: {
          id: employeeId,
          customerId,
        },
      });

      if (!employee) {
        throw new NotFoundException('Employee not found or does not belong to you');
      }

      return this.customerEmployeesService.changePassword(employeeId, changePasswordDto.currentPassword, changePasswordDto.newPassword);
    } else {
      throw new BadRequestException('Unauthorized');
    }
  }
}


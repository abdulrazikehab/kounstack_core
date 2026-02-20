import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { safeLog } from '../../security/log-redaction';

import { WalletService } from '../../cards/wallet.service';

@Controller('merchant/employees')
@UseGuards(JwtAuthGuard)
export class MerchantEmployeesController {
  private readonly logger = new Logger(MerchantEmployeesController.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Proxy endpoint for customer employees
   * Routes to auth service customer-employees endpoint
   */
  @Get()
  async getEmployees(
    @Request() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    this.logger.log('=== Get Employees Request ===');
    this.logger.log('User:', JSON.stringify({ 
      id: req.user?.id,
      userId: req.user?.userId,
      sub: req.user?.sub,
      type: req.user?.type, 
      role: req.user?.role,
      tenantId: req.user?.tenantId,
      email: req.user?.email 
    }, null, 2));
    this.logger.log('Has Authorization Header:', !!req.headers.authorization);

    // Check if user is authenticated
    if (!req.user) {
      this.logger.error('No user found in request - authentication failed');
      throw new BadRequestException('Authentication required. Please log in first.');
    }

    // Check user type - try multiple ways to determine if user is customer or shop owner
    const userType = req.user?.type;
    const userRole = req.user?.role;
    const isCustomer = userType === 'customer' || userRole === 'CUSTOMER' || userRole === 'CUSTOMER_EMPLOYEE';
    const isShopOwner = userRole === 'SHOP_OWNER' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

    this.logger.log('User type check:', { 
      userType, 
      userRole, 
      isCustomer, 
      isShopOwner,
      userId: req.user?.id 
    });

    if (!isCustomer && !isShopOwner) {
      this.logger.warn('Unauthorized user tried to access employees', {
        userType: req.user?.type,
        userRole: req.user?.role,
        userId: req.user?.id,
        email: req.user?.email
      });
      throw new BadRequestException(`Only customers and shop owners can access employees. Current user type: ${userType || 'unknown'}, role: ${userRole || 'unknown'}`);
    }

    // For shop owners, get staff from staff service
    if (isShopOwner) {
      try {
        const authBaseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                            this.configService.get<string>('AUTH_SERVICE_URL') || 
                            'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
        const token = req.headers.authorization?.replace('Bearer ', '') || '';

        const response = await firstValueFrom(
          this.httpService.get(`${authBaseUrl}/auth/staff`, {
          params: { page: pageNum, limit: limitNum },
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          })
        );

        return response.data;
      } catch (error: any) {
        this.logger.error('Failed to fetch shop owner employees:', error);
        if (error.response) {
          throw new BadRequestException(error.response.data?.message || 'Failed to fetch employees');
        }
        throw new BadRequestException('Failed to fetch employees');
      }
    }

    try {
      const authBaseUrl = this.configService.get<string>('AUTH_API_URL') || 'http://localhost:3001';
      const token = req.headers.authorization?.replace('Bearer ', '') || '';

      const baseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                       this.configService.get<string>('AUTH_SERVICE_URL') || 
                       'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
      
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/auth/customer-employees`, {
          params: { page: pageNum, limit: limitNum },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const employeesData = response.data;
      
      // Merge Core Wallet Balance
      const employeesList = Array.isArray(employeesData) ? employeesData : (employeesData.data || []);
      
      if (Array.isArray(employeesList) && employeesList.length > 0) {
        const employeesWithBalance = await Promise.all(employeesList.map(async (emp: any) => {
          try {
            // Fetch wallet balance from Core
            const wallet = await this.walletService.getBalance(emp.id).catch(() => null);
            return { 
                ...emp, 
                balance: wallet ? wallet.balance : 0 
            };
          } catch (e) {
            return { ...emp, balance: 0 };
          }
        }));
        
        if (Array.isArray(employeesData)) {
            return employeesWithBalance;
        } else {
            return { ...employeesData, data: employeesWithBalance };
        }
      }

      return employeesData;
    } catch (error: any) {
      this.logger.error('Failed to fetch customer employees:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        customerId: req.user?.id,
        userType: req.user?.type,
        userRole: req.user?.role,
      });
      
      if (error.response) {
        const errorData = error.response.data;
        let message = typeof errorData === 'object' 
          ? (errorData.message || errorData.error || JSON.stringify(errorData)) 
          : (errorData || 'Failed to fetch employees');
        
        // Provide more helpful error messages
        if (typeof message === 'string') {
          if (message.includes('User no longer exists')) {
            message = 'Your account could not be verified. Please log out and log back in.';
          } else if (message.includes('Customer not found')) {
            message = 'Customer account not found. Please ensure you are logged in as a customer.';
          }
        }
        
        throw new BadRequestException(message || 'Failed to fetch employees');
      }
      throw new BadRequestException('Failed to fetch employees. Please try again or contact support.');
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEmployee(
    @Request() req: any,
    @Body() body: {
      name?: string;
      username?: string;
      email?: string;
      password?: string;
      phone?: string;
      permissions?: any;
    },
  ) {
    this.logger.log('=== Create Employee Request ===');
    this.logger.log('Full Request User:', JSON.stringify(req.user, null, 2));
    this.logger.log('Request TenantId:', req.tenantId);
    this.logger.log('Headers:', JSON.stringify({ 
      'x-tenant-id': req.headers['x-tenant-id'],
      'x-tenant-domain': req.headers['x-tenant-domain']
    }, null, 2));
    safeLog(this.logger, 'Body:', body);
    
    // Ensure tenantId is available - get from user, request, or headers
    // Priority: user.tenantId > request.tenantId > header x-tenant-id
    let tenantId = req.user?.tenantId || req.tenantId || req.headers['x-tenant-id'];
    
    // If still no tenantId, try to extract from JWT token directly
    if (!tenantId) {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          const secret = this.configService.get<string>('JWT_SECRET');
          if (secret) {
            const payload = this.jwtService.verify(token, { secret });
            tenantId = payload.tenantId;
            // Also update req.user with missing fields from token
            if (!req.user.email && payload.email) {
              req.user.email = payload.email;
            }
            if (!req.user.role && payload.role) {
              req.user.role = payload.role;
            }
            if (!req.user.type && payload.type) {
              req.user.type = payload.type;
            }
            this.logger.log('Extracted from JWT token:', { tenantId, email: payload.email, role: payload.role });
          }
        }
      } catch (error: any) {
        this.logger.warn('Failed to extract from token:', error.message);
      }
    }
    
    // Update req.user with tenantId, email, and role if missing (before checking user type)
    if (!req.user.tenantId && tenantId) {
      req.user.tenantId = tenantId;
    }
    if (!req.user.email && req.headers['x-user-email']) {
      req.user.email = req.headers['x-user-email'];
    }
    if (!req.user.role && req.headers['x-user-role']) {
      req.user.role = req.headers['x-user-role'];
    }

    // Check user type - try multiple ways to determine if user is customer or shop owner
    const userType = req.user?.type;
    const userRole = req.user?.role;
    const isCustomer = userType === 'customer' || userRole === 'CUSTOMER' || userRole === 'CUSTOMER_EMPLOYEE';
    const isShopOwner = userRole === 'SHOP_OWNER' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

    this.logger.log('User type check for create:', { 
      userType, 
      userRole, 
      isCustomer, 
      isShopOwner,
      userId: req.user?.id,
      email: req.user?.email
    });

    if (!isCustomer && !isShopOwner) {
      this.logger.warn('Unauthorized user tried to create employee', {
        userType: req.user?.type,
        userRole: req.user?.role,
        userId: req.user?.id,
        email: req.user?.email
      });
      throw new BadRequestException(`Only customers and shop owners can create employees. Current user type: ${userType || 'unknown'}, role: ${userRole || 'unknown'}`);
    }

    // For customers, they don't need tenantId - they use customerId
    // For shop owners, tenantId is required
    if (isCustomer) {
      // Customers don't need tenantId - they use their customerId from the token
      this.logger.log('Customer creating employee - tenantId not required');
      return this.createCustomerEmployee(req, body);
    }

    // For shop owners, tenantId is required
    if (isShopOwner) {
      if (!tenantId) {
        this.logger.error('Shop owner needs tenantId to create employee', {
          userTenantId: req.user?.tenantId,
          requestTenantId: req.tenantId,
          headerTenantId: req.headers['x-tenant-id'],
          user: req.user
        });
        throw new BadRequestException('Tenant ID is required for shop owners. Please ensure you have created a store first.');
      }
      // Ensure tenantId is set for shop owners
      if (!req.user.tenantId && tenantId) {
        req.user.tenantId = tenantId;
      }
      return this.createShopOwnerEmployee(req, body);
    }
  }

  /**
   * Create employee for shop owner (platform staff)
   */
  private async createShopOwnerEmployee(req: any, body: any) {
    const email = body.email || body.username || '';
    if (!email) {
      throw new BadRequestException('Email or username is required');
    }

    // If username doesn't have @, convert it to email format
    let finalEmail = email;
    if (!email.includes('@')) {
      finalEmail = `${email}@employee.local`;
      this.logger.log(`Username provided without @, converting to: ${finalEmail}`);
    }

    // Validate name is required and not empty
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Name is required');
    }

    // Get tenantId from user or request
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) {
      this.logger.error('No tenantId found for shop owner', { user: req.user });
      throw new BadRequestException('Tenant ID is required. Please ensure you have created a store first.');
    }

    // Convert email to lowercase (only ASCII part before @, preserve Unicode in local part if needed)
    const emailParts = finalEmail.split('@');
    const localPart = emailParts[0];
    const domainPart = emailParts[1] || '';
    // Only lowercase the domain part, preserve local part as-is for Unicode support
    const normalizedEmail = domainPart ? `${localPart}@${domainPart.toLowerCase()}` : finalEmail.toLowerCase();

    // Password is optional - will be auto-generated if not provided
    const staffData = {
      email: normalizedEmail.trim(),
      name: body.name.trim(), // Preserve Unicode/Arabic characters in name
      phone: body.phone?.trim() || '',
      password: body.password?.trim() || undefined, // Optional - will be auto-generated if not provided
      permissions: this.mapShopOwnerPermissions(body.permissions),
      role: 'STAFF', // Shop owner employees are STAFF role
    };

    this.logger.log('Creating shop owner employee:', { email: staffData.email, tenantId });

    try {
      const authBaseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                          this.configService.get<string>('AUTH_SERVICE_URL') || 
                          'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
      const token = req.headers.authorization?.replace('Bearer ', '') || '';

      if (!token) {
        throw new BadRequestException('Authentication token is required');
      }

      const response = await firstValueFrom(
        this.httpService.post(`${authBaseUrl}/auth/staff`, staffData, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        })
      );

      this.logger.log('Successfully created shop owner employee');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to create shop owner employee:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });
      
      if (error.response) {
        const errorMessage = error.response.data?.message || 
                           error.response.data?.error || 
                           `Failed to create employee: ${error.response.statusText}`;
        throw new BadRequestException(errorMessage);
      }
      
      throw new BadRequestException(error.message || 'Failed to create employee');
    }
  }

  /**
   * Create employee for customer (store employee)
   */
  private async createCustomerEmployee(req: any, body: any) {
    // Map the request body to customer employee format
    // Frontend sends 'username' but backend expects 'email'
    const email = body.email || body.username || '';
    if (!email || !email.trim()) {
      this.logger.warn('No email or username provided', { body });
      throw new BadRequestException('Email or username is required');
    }

    // If username doesn't have @, convert it to email format
    let finalEmail = email.trim();
    if (!finalEmail.includes('@')) {
      finalEmail = `${finalEmail}@employee.local`;
      this.logger.log(`Username provided without @, converting to: ${finalEmail}`);
    }

    // Password is now auto-generated - not required from frontend
    // Name is optional (can be derived from email if not provided)
    // Phone is optional

    // Validate phone is optional but if provided should be valid
    const phone = body.phone?.trim() || undefined;
    const name = body.name?.trim() || undefined;

    // Convert email to lowercase (only ASCII part before @, preserve Unicode in local part if needed)
    // For standard emails, toLowerCase is fine. For Unicode emails, we preserve the original
    const emailParts = finalEmail.split('@');
    const localPart = emailParts[0];
    const domainPart = emailParts[1] || '';
    // Only lowercase the domain part, preserve local part as-is for Unicode support
    const normalizedEmail = domainPart ? `${localPart}@${domainPart.toLowerCase()}` : finalEmail.toLowerCase();

    const employeeData = {
      email: normalizedEmail.trim(),
      name: name, // Optional - backend will use email prefix if not provided
      phone: phone,
      // Password is auto-generated - don't include it
      permissions: this.mapPermissions(body.permissions || {}),
    };

    this.logger.log('Mapped employee data:', { 
      email: employeeData.email, 
      name: employeeData.name,
      hasPhone: !!employeeData.phone,
      // hasPassword property check removed as password field is not in employeeData struct
      permissionsCount: employeeData.permissions?.length || 0
    });

    this.logger.log('Sending to auth service:', JSON.stringify(employeeData, null, 2));

    try {
      const authBaseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                          this.configService.get<string>('AUTH_SERVICE_URL') || 
                          'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
      const token = req.headers.authorization?.replace('Bearer ', '') || '';

      if (!token) {
        this.logger.error('No authorization token found');
        throw new BadRequestException('Authentication token is required');
      }

      const authUrl = `${authBaseUrl}/auth/customer-employees`;
      
      // Use safeLog for redaction
      safeLog(this.logger, `Calling auth service: ${authUrl}`, employeeData);
      
      // Log token info for debugging (without exposing the full token)
      this.logger.log(`Proxying to auth service with token:`, {
        hasToken: !!token,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        userFromRequest: {
          id: req.user?.id,
          type: req.user?.type,
          role: req.user?.role,
          email: req.user?.email,
          tenantId: req.user?.tenantId,
        },
      });

      const response = await firstValueFrom(
        this.httpService.post(authUrl, employeeData, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            // Forward tenant domain header if present
            ...(req.headers['x-tenant-domain'] ? { 'X-Tenant-Domain': req.headers['x-tenant-domain'] } : {}),
            ...(req.headers['x-tenant-id'] ? { 'X-Tenant-Id': req.headers['x-tenant-id'] } : {}),
          },
          timeout: 10000,
        })
      );

      this.logger.log('Successfully created customer employee');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to create customer employee:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        statusCode: error.response?.status,
        customerId: req.user?.id,
        userType: req.user?.type,
        userRole: req.user?.role,
        hasToken: !!req.headers.authorization,
        tokenPrefix: req.headers.authorization?.substring(0, 20),
      });
      
      // Handle HTTP errors from auth service
      if (error.response) {
        const errorData = error.response.data;
        const statusCode = error.response.status;
        
        // If it's a 401, it means authentication failed at the auth service
        if (statusCode === 401) {
          this.logger.error('Auth service returned 401 - token validation failed', {
            errorData,
            customerId: req.user?.id,
          });
          throw new BadRequestException('Authentication failed. Please log out and log back in. If the issue persists, your account may need to be re-verified.');
        }
        
        let errorMessage = typeof errorData === 'object' 
          ? (errorData.message || errorData.error || JSON.stringify(errorData))
          : (errorData || `Failed to create employee: ${error.response.statusText}`);
        
        // Provide more helpful error messages
        if (typeof errorMessage === 'string') {
          if (errorMessage.includes('User no longer exists') || errorMessage.includes('User account not found')) {
            errorMessage = 'Your account could not be verified. Please log out and log back in. If the issue persists, your account may have been deleted or needs to be re-verified.';
          } else if (errorMessage.includes('Customer not found')) {
            errorMessage = 'Customer account not found. Please ensure you are logged in as a customer.';
          } else if (errorMessage.includes('already exists')) {
            errorMessage = 'An employee with this email already exists.';
          } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('Authentication')) {
            errorMessage = 'Authentication failed. Please log out and log back in.';
          }
        }
        
        throw new BadRequestException(errorMessage);
      }
      
      // Handle non-HTTP errors
      if (error.message) {
        // Check for specific error messages
        if (error.message.includes('User no longer exists') || error.message.includes('User account not found')) {
          throw new BadRequestException('Your account could not be verified. Please log out and log back in. If the issue persists, your account may have been deleted or needs to be re-verified.');
        }
        if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
          throw new BadRequestException('Unable to connect to the authentication service. Please try again in a moment.');
        }
        throw new BadRequestException(error.message);
      }
      
      throw new BadRequestException('Failed to create employee. Please try again or contact support.');
    }
  }



  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateEmployee(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const userType = req.user?.type;
    const userRole = req.user?.role;
    const isCustomer = userType === 'customer' || userRole === 'CUSTOMER' || userRole === 'CUSTOMER_EMPLOYEE';
    const isShopOwner = userRole === 'SHOP_OWNER' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

    if (!isCustomer && !isShopOwner) {
      throw new BadRequestException(`Only customers and shop owners can update employees. Current user type: ${userType || 'unknown'}, role: ${userRole || 'unknown'}`);
    }

    if (isCustomer) {
      return this.updateCustomerEmployee(req, id, body);
    }

    // For shop owners, we might need to implement updateShopOwnerEmployee
    // For now, throw not implemented or try to implement it
    throw new BadRequestException('Updating shop owner employees is not supported yet');
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async patchEmployee(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    // PATCH is an alias for PUT - same logic
    return this.updateEmployee(req, id, body);
  }

  @Post(':id/balance')
  @HttpCode(HttpStatus.OK)
  async addBalance(
    @Request() req: any,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    const userType = req.user?.type;
    const userRole = req.user?.role;
    const isCustomer = userType === 'customer' || userRole === 'CUSTOMER' || userRole === 'CUSTOMER_EMPLOYEE';
    if (!isCustomer) {
      throw new BadRequestException(`Only customers can add balance to employees. Current user type: ${userType || 'unknown'}, role: ${userRole || 'unknown'}`);
    }

    if (!amount || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const customerId = req.user?.id || req.user?.userId;
    if (!customerId) {
        throw new BadRequestException('Customer ID not found');
    }

    // 1. Deduct from Customer Wallet
    await this.walletService.debit(
      customerId,
      amount,
      `Transfer to employee ${id}`,
      `تحويل للموظف ${id}`,
      `EMP-TRANSFER-${id}-${Date.now()}`
    );

    // 2. Add to Employee Wallet (Core)
    try {
      // We use employeeId as userId for the wallet
      // We don't have employee details here, so if user doesn't exist in core,
      // WalletService will create a placeholder user.
      // Ideally we should fetch employee details from Auth first to have correct email/name,
      // but for now this ensures the wallet exists and has funds.
      
      // Ensure wallet exists first (with tenantId from request)
      await this.walletService.getOrCreateWallet(
        req.user.tenantId, 
        id, 
        { role: 'CUSTOMER_EMPLOYEE' } // Hint role
      );

      await this.walletService.credit(
        id,
        amount,
        `Transfer from employer`,
        `تحويل من صاحب العمل`,
        `EMP-TRANSFER-RX-${id}-${Date.now()}`,
        'TOPUP'
      );

      return { success: true, message: 'Balance added successfully' };
    } catch (error: any) {
      this.logger.error('Failed to add balance to employee wallet', error);
      
      // Refund the customer
      await this.walletService.credit(
        customerId,
        amount,
        `Refund: Failed transfer to employee ${id}`,
        `استرداد: فشل التحويل للموظف ${id}`,
        `REFUND-EMP-TRANSFER-${id}-${Date.now()}`,
        'REFUND'
      );
      
      throw new BadRequestException('Failed to transfer balance to employee');
    }
  }

  private async updateCustomerEmployee(req: any, id: string, body: any) {
    // Map body to update DTO
    const updateData: any = {
      name: body.name,
      phone: body.phone,
      permissions: this.mapPermissions(body.permissions),
    };

    if (body.password) {
      updateData.password = body.password;
    }

    try {
      const authBaseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                          this.configService.get<string>('AUTH_SERVICE_URL') || 
                          'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
      const token = req.headers.authorization?.replace('Bearer ', '') || '';

      const response = await firstValueFrom(
        this.httpService.put(`${authBaseUrl}/auth/customer-employees/${id}`, updateData, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to update customer employee:', error);
      if (error.response) {
        throw new BadRequestException(error.response.data?.message || 'Failed to update employee');
      }
      throw new BadRequestException('Failed to update employee');
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteEmployee(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userType = req.user?.type;
    const userRole = req.user?.role;
    const isCustomer = userType === 'customer' || userRole === 'CUSTOMER' || userRole === 'CUSTOMER_EMPLOYEE';

    if (!isCustomer) {
      throw new BadRequestException(`Only customers can delete their employees. Current user type: ${userType || 'unknown'}, role: ${userRole || 'unknown'}`);
    }

    try {
      const authBaseUrl = this.configService.get<string>('AUTH_API_URL') || 'http://localhost:3001';
      const token = req.headers.authorization?.replace('Bearer ', '') || '';

      const baseUrl = (this.configService.get<string>('AUTH_API_URL') || 
                       this.configService.get<string>('AUTH_SERVICE_URL') || 
                       'http://localhost:3001').replace(/\/api$/, '').replace(/\/+$/, '');
      
      const response = await firstValueFrom(
        this.httpService.delete(`${baseUrl}/auth/customer-employees/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to delete customer employee:', error);
      if (error.response) {
        throw new BadRequestException(error.response.data?.message || 'Failed to delete employee');
      }
      throw new BadRequestException('Failed to delete employee');
    }
  }

  /**
   * Map permissions from MerchantSections format to store permission format (for customers)
   */
  private mapPermissions(permissions: any): string[] {
    if (!permissions || typeof permissions !== 'object') {
      return [];
    }

    const mapped: string[] = [];

    // Map boolean permissions to store permissions
    if (permissions.ordersCreate) mapped.push('store:orders:create');
    if (permissions.ordersRead) mapped.push('store:orders:view');
    if (permissions.reportsRead) mapped.push('store:analytics:view');
    if (permissions.walletRead) mapped.push('store:wallet:view');
    if (permissions.playersWrite) mapped.push('store:customers:edit');
    if (permissions.employeesManage) mapped.push('store:employees:manage');
    if (permissions.settingsWrite) mapped.push('store:settings:update');
    if (permissions.invoicesRead) mapped.push('store:invoices:view');
    
    // Mobile App Permissions
    if (permissions.mobileAccess) mapped.push('mobile:merchant:access');
    if (permissions.mobileOrders) mapped.push('mobile:merchant:orders');
    if (permissions.mobileProducts) mapped.push('mobile:merchant:products');
    if (permissions.mobileCustomers) mapped.push('mobile:merchant:customers');
    if (permissions.mobileAnalytics) mapped.push('mobile:merchant:analytics');

    return mapped;
  }

  /**
   * Map permissions from MerchantSections format to platform permission format (for shop owners)
   */
  private mapShopOwnerPermissions(permissions: any): string[] {
    if (!permissions || typeof permissions !== 'object') {
      return [];
    }

    const mapped: string[] = [];

    // Map boolean permissions to platform permissions
    if (permissions.ordersCreate) mapped.push('order:create');
    if (permissions.ordersRead) mapped.push('order:read');
    if (permissions.reportsRead) mapped.push('analytics:read');
    if (permissions.walletRead) mapped.push('wallet:read');
    if (permissions.playersWrite) mapped.push('customer:update');
    if (permissions.employeesManage) mapped.push('staff:manage');
    if (permissions.settingsWrite) mapped.push('settings:update');
    if (permissions.invoicesRead) mapped.push('invoice:read');

    return mapped;
  }
}


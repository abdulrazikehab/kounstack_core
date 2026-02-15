import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { EmployeeService } from '../services/employee.service';
import { MerchantService } from '../services/merchant.service';
import { MerchantAuditService } from '../services/merchant-audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';
import { CreateEmployeeDto, UpdateEmployeeDto, EmployeeListQuery } from '../dto';

@Controller('merchant/internal/employees')
@UseGuards(JwtAuthGuard)
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly merchantService: MerchantService,
    private readonly auditService: MerchantAuditService,
  ) {}

  @Get('health')
  healthCheck() {
    return { status: 'ok', route: 'merchant/employees' };
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query() query: EmployeeListQuery,
  ) {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        throw new BadRequestException('User authentication required');
      }
      
      // Auto-create merchant if it doesn't exist
      let context;
      try {
        // Check for employeesRead OR employeesManage permission
        context = await this.merchantService.validateMerchantAccess(userId);
        // If not owner, check if user has employeesRead or employeesManage
        if (!context.isOwner) {
          const permissions = context.permissions as any;
          if (!permissions || (!permissions.employeesRead && !permissions.employeesManage)) {
            throw new BadRequestException('Permission denied: employeesRead or employeesManage required');
          }
        }
      } catch (error: any) {
        // If merchant doesn't exist, create it automatically
        if (error.message?.includes('No merchant account')) {
          const tenantId = req.user?.tenantId || req.tenantId;
          if (!tenantId) {
            return []; // Return empty array if no tenant
          }
          await this.merchantService.getOrCreateMerchant(tenantId, userId);
          context = await this.merchantService.validateMerchantAccess(userId);
          // Check permissions again after creating merchant
          if (!context.isOwner) {
            const permissions = context.permissions as any;
            if (!permissions || (!permissions.employeesRead && !permissions.employeesManage)) {
              return []; // Return empty array if no permission
            }
          }
        } else {
          return []; // Return empty array for other errors
        }
      }
      
      return this.employeeService.findAll(context.merchantId, query);
    } catch (error) {
      return []; // Return empty array if merchant access fails
    }
  }

  @Post()
  @UsePipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false, // Allow extra fields like groupId
    transformOptions: {
      enableImplicitConversion: true,
    },
  }))
  async create(
    @Request() req: any,
    @Body() dto: CreateEmployeeDto,
  ) {
    console.log('📝 POST /merchant/employees - Request received:', {
      hasUser: !!req.user,
      userId: req.user?.id || req.user?.userId,
      tenantId: req.user?.tenantId,
      body: JSON.stringify(dto, null, 2),
      bodyType: typeof dto,
      hasName: !!dto?.name,
      hasUsername: !!dto?.username,
      hasPassword: !!dto?.password,
      hasPermissions: !!dto?.permissions,
      permissionsType: typeof dto?.permissions,
    });
    
    // Validate required fields manually to provide better error messages
    if (!dto?.name || typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      throw new BadRequestException('Name is required and must be a non-empty string');
    }
    if (!dto?.username || typeof dto.username !== 'string' || dto.username.length < 3) {
      throw new BadRequestException('Username is required and must be at least 3 characters');
    }
    if (!dto?.password || typeof dto.password !== 'string' || dto.password.length < 6) {
      throw new BadRequestException('Password is required and must be at least 6 characters');
    }
    
      // Provide default permissions if not provided - all permissions default to false
      if (!dto.permissions || typeof dto.permissions !== 'object') {
        dto.permissions = {
          ordersCreate: false,
          ordersRead: false,
          ordersUpdate: false,
          ordersDelete: false,
          reportsRead: false,
          walletRead: false,
          walletRecharge: false,
          playersWrite: false,
          playersRead: false,
          employeesManage: false,
          employeesRead: false,
          settingsWrite: false,
          settingsRead: false,
          invoicesRead: false,
          productsRead: false,
          productsWrite: false,
        };
      } else {
        // Normalize permissions - ensure all fields are boolean
        dto.permissions = {
          ordersCreate: dto.permissions.ordersCreate ?? false,
          ordersRead: dto.permissions.ordersRead ?? false,
          ordersUpdate: dto.permissions.ordersUpdate ?? false,
          ordersDelete: dto.permissions.ordersDelete ?? false,
          reportsRead: dto.permissions.reportsRead ?? false,
          walletRead: dto.permissions.walletRead ?? false,
          walletRecharge: dto.permissions.walletRecharge ?? false,
          playersWrite: dto.permissions.playersWrite ?? false,
          playersRead: dto.permissions.playersRead ?? false,
          employeesManage: dto.permissions.employeesManage ?? false,
          employeesRead: dto.permissions.employeesRead ?? false,
          settingsWrite: dto.permissions.settingsWrite ?? false,
          settingsRead: dto.permissions.settingsRead ?? false,
          invoicesRead: dto.permissions.invoicesRead ?? false,
          productsRead: dto.permissions.productsRead ?? false,
          productsWrite: dto.permissions.productsWrite ?? false,
        };
      }
    
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      console.error('❌ No user ID found in request');
      throw new BadRequestException('User authentication required');
    }
    
    // Auto-create merchant if it doesn't exist
    let context;
    try {
      context = await this.merchantService.validateMerchantAccess(userId, 'employeesManage');
    } catch (error: any) {
      // If merchant doesn't exist, create it automatically
      if (error instanceof NotFoundException || error.message?.includes('No merchant account') || error.statusCode === 404) {
        const tenantId = req.user?.tenantId || req.user?.id;
        console.log('🛒 Auto-creating merchant account:', { userId, tenantId, user: req.user });
        if (!tenantId) {
          throw new BadRequestException('Tenant ID is required to create merchant account. Please ensure you have set up your market/store.');
        }
        try {
          await this.merchantService.getOrCreateMerchant(tenantId, userId);
          context = await this.merchantService.validateMerchantAccess(userId, 'employeesManage');
          console.log('✅ Merchant account created successfully:', context.merchantId);
        } catch (createError: any) {
          console.error('❌ Failed to create merchant account:', createError);
          throw new BadRequestException(`Failed to create merchant account: ${createError.message || 'Unknown error'}`);
        }
      } else {
        throw error;
      }
    }

    const employee = await this.employeeService.create(context.merchantId, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.EMPLOYEE_CREATED,
      'Employee',
      employee.id,
      { name: dto.name, username: dto.username },
    );

    return employee;
  }

  @Get(':id')
  async findOne(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);
    
    // Check for employeesRead OR employeesManage permission (or isOwner)
    if (!context.isOwner) {
      const permissions = context.permissions as any;
      if (!permissions || (!permissions.employeesRead && !permissions.employeesManage)) {
        throw new BadRequestException('Permission denied: employeesRead or employeesManage required');
      }
    }

    return this.employeeService.findOne(context.merchantId, id);
  }

  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);
    
    // Check for employeesManage permission (or isOwner)
    if (!context.isOwner) {
      const permissions = context.permissions as any;
      if (!permissions || !permissions.employeesManage) {
        throw new BadRequestException('Permission denied: employeesManage required');
      }
    }

    // Normalize permissions - ensure all fields are boolean and default to false if not provided
    if (dto.permissions) {
      const normalizedPermissions: any = {
        ordersCreate: dto.permissions.ordersCreate ?? false,
        ordersRead: dto.permissions.ordersRead ?? false,
        ordersUpdate: dto.permissions.ordersUpdate ?? false,
        ordersDelete: dto.permissions.ordersDelete ?? false,
        reportsRead: dto.permissions.reportsRead ?? false,
        walletRead: dto.permissions.walletRead ?? false,
        walletRecharge: dto.permissions.walletRecharge ?? false,
        playersWrite: dto.permissions.playersWrite ?? false,
        playersRead: dto.permissions.playersRead ?? false,
        employeesManage: dto.permissions.employeesManage ?? false,
        employeesRead: dto.permissions.employeesRead ?? false,
        settingsWrite: dto.permissions.settingsWrite ?? false,
        settingsRead: dto.permissions.settingsRead ?? false,
        invoicesRead: dto.permissions.invoicesRead ?? false,
        productsRead: dto.permissions.productsRead ?? false,
        productsWrite: dto.permissions.productsWrite ?? false,
      };
      dto.permissions = normalizedPermissions;
    }

    const employee = await this.employeeService.update(context.merchantId, id, dto);

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.EMPLOYEE_UPDATED,
      'Employee',
      id,
      { changes: dto },
    );

    return employee;
  }

  @Delete(':id')
  async delete(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);
    
    // Check for employeesManage permission (or isOwner)
    if (!context.isOwner) {
      const permissions = context.permissions as any;
      if (!permissions || !permissions.employeesManage) {
        throw new BadRequestException('Permission denied: employeesManage required');
      }
    }

    await this.auditService.log(
      context.merchantId,
      userId,
      context.employeeId,
      context.isOwner ? 'MERCHANT' : 'EMPLOYEE',
      MerchantAuditService.Actions.EMPLOYEE_DISABLED,
      'Employee',
      id,
    );

    return this.employeeService.delete(context.merchantId, id);
  }
}


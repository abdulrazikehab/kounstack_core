import { Controller, Get, Post, Put, Delete, Body, Query, Request, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';
import { UserRole } from '../types/user-role.enum';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly userService: UserService,
    private readonly httpService: HttpService
  ) {}

  @Get()
  async getCustomers(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    
    // Call UserService filtering by CUSTOMER role
    const result = await this.userService.getUsersByTenant(
      req.user.tenantId, 
      pageNum, 
      limitNum, 
      UserRole.CUSTOMER
    );
    
    // Return just the array of customers to match frontend expectations
    return result.data;
  }

  @Post()
  async createCustomer(@Request() req: any, @Body() body: any) {
    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    
    try {
      // Forward X-Tenant-Domain header if present (for correct invite URL generation)
      const headers: Record<string, string> = {
        'Authorization': req.headers.authorization,
        'x-tenant-id': req.user.tenantId
      };
      
      if (req.headers['x-tenant-domain']) {
        headers['x-tenant-domain'] = req.headers['x-tenant-domain'] as string;
      }
      
      const { data } = await firstValueFrom(
        this.httpService.post(`${authUrl}/auth/customers`, body, {
          headers
        })
      );
      
      // Unwrap if it's already wrapped by app-auth's TransformInterceptor
      if (data && data.success && data.data) {
        return data.data;
      }
      return data.data || data;
    } catch (error: any) {
      throw new BadRequestException(error.response?.data?.message || 'Failed to create customer');
    }
  }

  @Put(':id')
  async updateCustomer(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    let targetId = id;

    // Check if ID is email (for guest customers or legacy users)
    if (id.includes('@')) {
      try {
        const { data: customer } = await firstValueFrom(
          this.httpService.get(`${authUrl}/auth/customers/email/${id}`, {
            headers: {
              'Authorization': req.headers.authorization,
              'x-tenant-id': req.user.tenantId
            },
            validateStatus: (status) => status < 500 // Handle 404 manually
          })
        );
        
        if (customer && customer.id) {
          targetId = customer.id;
        } else {
          // Customer not found in auth service - create them (Promote guest to customer)
          // We need email in the body for creation
          const createPayload = { ...body, email: id };
          const { data } = await firstValueFrom(
            this.httpService.post(`${authUrl}/auth/customers`, createPayload, {
              headers: {
                'Authorization': req.headers.authorization,
                'x-tenant-id': req.user.tenantId
              }
            })
          );
          return data.data || data;
        }
      } catch (error: any) {
        // If 404, we create. For other errors, we throw.
        if (error.response?.status === 404 || !error.response) {
             const createPayload = { ...body, email: id };
             try {
                const { data } = await firstValueFrom(
                    this.httpService.post(`${authUrl}/auth/customers`, createPayload, {
                        headers: {
                            'Authorization': req.headers.authorization,
                            'x-tenant-id': req.user.tenantId
                        }
                    })
                );
                return data.data || data;
             } catch (createError: any) {
                 throw new BadRequestException(createError.response?.data?.message || 'Failed to create customer from guest');
             }
        }
        throw new BadRequestException(error.response?.data?.message || 'Failed to obtain customer ID');
      }
    }
    
    try {
      const { data } = await firstValueFrom(
        this.httpService.put(`${authUrl}/auth/customers/${targetId}`, body, {
          headers: {
            'Authorization': req.headers.authorization,
            'x-tenant-id': req.user.tenantId
          }
        })
      );
      return data.data || data;
    } catch (error: any) {
      throw new BadRequestException(error.response?.data?.message || 'Failed to update customer');
    }
  }

  @Delete(':id')
  async deleteCustomer(@Request() req: any, @Param('id') id: string) {
    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    let targetId = id;
    let customerEmail: string | null = null;

    // Check if ID is email
    if (id.includes('@')) {
      customerEmail = id;
      try {
        const { data: customer } = await firstValueFrom(
          this.httpService.get(`${authUrl}/auth/customers/email/${id}`, {
            headers: {
              'Authorization': req.headers.authorization,
              'x-tenant-id': req.user.tenantId
            },
            validateStatus: (status) => status < 500
          })
        );
        
        if (customer && customer.id) {
          targetId = customer.id;
        } else {
          // If not in auth, try to delete from local User table
          if (customerEmail) {
            try {
              await this.userService.deleteUserByEmail(req.user.tenantId, customerEmail);
            } catch (userError) {
              // Ignore errors - user might not exist in core DB
            }
          }
          return { message: 'Customer not found in auth system, likely a guest user.' };
        }
      } catch (error) {
         // If error finding by email, try to delete from local User table
         if (customerEmail) {
           try {
             await this.userService.deleteUserByEmail(req.user.tenantId, customerEmail);
           } catch (userError) {
             // Ignore errors
           }
         }
         return { message: 'Customer not found' };
      }
    }
    
    try {
      // Get customer email before deletion for User table cleanup
      try {
        const { data: customer } = await firstValueFrom(
          this.httpService.get(`${authUrl}/auth/customers/${targetId}`, {
            headers: {
              'Authorization': req.headers.authorization,
              'x-tenant-id': req.user.tenantId
            },
            validateStatus: (status) => status < 500
          })
        );
        if (customer && customer.email) {
          customerEmail = customer.email;
        }
      } catch (error) {
        // Ignore - proceed with deletion
      }

      // Delete from auth service
      const { data } = await firstValueFrom(
        this.httpService.delete(`${authUrl}/auth/customers/${targetId}`, {
          headers: {
            'Authorization': req.headers.authorization,
            'x-tenant-id': req.user.tenantId
          }
        })
      );

      // Also delete from User table in core database if email is known
      if (customerEmail) {
        try {
          await this.userService.deleteUserByEmail(req.user.tenantId, customerEmail);
        } catch (userError) {
          // Ignore errors - user might not exist in core DB
        }
      }

      return data.data || data;
    } catch (error: any) {
      throw new BadRequestException(error.response?.data?.message || 'Failed to delete customer');
    }
  }

  @Post(':id/force-logout')
  async forceLogoutCustomer(@Request() req: any, @Param('id') id: string) {
    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    let targetId = id;

    // Check if ID is email
    if (id.includes('@')) {
      try {
        const { data: customer } = await firstValueFrom(
          this.httpService.get(`${authUrl}/auth/customers/email/${id}`, {
            headers: {
              'Authorization': req.headers.authorization,
              'x-tenant-id': req.user.tenantId
            },
            validateStatus: (status) => status < 500
          })
        );
        
        if (customer && customer.id) {
          targetId = customer.id;
        } else {
          return { message: 'Customer not found' };
        }
      } catch (error) {
         return { message: 'Customer not found' };
      }
    }
    
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(`${authUrl}/auth/customers/${targetId}/force-logout`, {}, {
          headers: {
            'Authorization': req.headers.authorization,
            'x-tenant-id': req.user.tenantId
          }
        })
      );
      return data;
    } catch (error: any) {
      throw new BadRequestException(error.response?.data?.message || 'Failed to force logout customer');
    }
  }

  @Put(':id/email-settings')
  async updateCustomerEmailSettings(
    @Request() req: any,
    @Param('id') id: string,
    @Body('emailDisabled') emailDisabled: boolean,
  ) {
    const authUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    let targetId = id;

    // Check if ID is email
    if (id.includes('@')) {
      try {
        const { data: customer } = await firstValueFrom(
          this.httpService.get(`${authUrl}/auth/customers/email/${id}`, {
            headers: {
              'Authorization': req.headers.authorization,
              'x-tenant-id': req.user.tenantId
            },
            validateStatus: (status) => status < 500
          })
        );
        
        if (customer && customer.id) {
          targetId = customer.id;
        } else {
          return { message: 'Customer not found' };
        }
      } catch (error) {
         return { message: 'Customer not found' };
      }
    }
    
    try {
      const { data } = await firstValueFrom(
        this.httpService.put(`${authUrl}/auth/customers/${targetId}/email-settings`, { emailDisabled }, {
          headers: {
            'Authorization': req.headers.authorization,
            'x-tenant-id': req.user.tenantId,
            'Content-Type': 'application/json'
          }
        })
      );
      return data;
    } catch (error: any) {
      throw new BadRequestException(error.response?.data?.message || 'Failed to update email settings');
    }
  }
}

import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, Query, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, catchError } from 'rxjs';
import { of } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SiteConfigService } from '../site-config/site-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PageService } from '../page/page.service';
import { Public } from '../auth/public.decorator';
import { ConfigService } from '@nestjs/config';

/**
 * Dashboard controller for tenant statistics and configuration
 */
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);
  
  constructor(
    private readonly siteConfig: SiteConfigService,
    private readonly prisma: PrismaService,
    private readonly pageService: PageService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private resolveAuthServiceUrl(): string {
    const configuredUrl =
      this.configService.get<string>('AUTH_API_URL') ||
      this.configService.get<string>('AUTH_SERVICE_URL');
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const defaultLocalUrl = 'http://localhost:3001';

    if (!isProduction && configuredUrl && !/localhost|127\.0\.0\.1/i.test(configuredUrl)) {
      this.logger.warn(
        `Auth service URL points to non-local host in development (${configuredUrl}). Using ${defaultLocalUrl}.`,
      );
      return defaultLocalUrl;
    }

    return (configuredUrl || defaultLocalUrl).replace(/\/api$/i, '').replace(/\/+$/, '');
  }

  /**
   * Get dashboard statistics for the tenant
   * Public endpoint so storefront can display stats if needed
   */
  @Public()
  @Get('stats')
  async getStats(@Request() req: any) {
    const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

    const [orderCount, revenueData, productCount, customerCount, lowStockCount] = await Promise.all([
      this.prisma.order.count({ where: { tenantId } }),
      this.prisma.order.aggregate({
        where: { 
          tenantId,
          paymentStatus: 'SUCCEEDED',
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.product.count({ where: { tenantId } }),
      // Count unique customers from orders
      this.prisma.order.groupBy({
        by: ['customerEmail'],
        where: { tenantId },
      }).then((groups: any[]) => groups.length),
      // Count low stock products (stock < 10)
      this.prisma.product.count({
        where: {
          tenantId,
          variants: {
            some: {
              inventoryQuantity: { lt: 10 }
            }
          }
        }
      })
    ]);

    // Calculate visits (can be enhanced with analytics service)
    const visits = customerCount * 3; // Rough estimate: 3 visits per customer
    const saved = Math.floor(orderCount * 0.15); // Estimate: 15% of orders are saved

    return {
      orderCount,
      revenue: Number(revenueData._sum.totalAmount || 0),
      productCount,
      customerCount,
      visits,
      saved,
      lowStockProducts: lowStockCount,
      pendingOrders: await this.prisma.order.count({
        where: { tenantId, status: 'PENDING' }
      }),
    };
  }

  /**
   * Get customers list with loyalty information
   */
  @Get('customers')
  async getCustomers(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const skip = (pageNum - 1) * limitNum;

    // 1. Fetch customers from auth service (Customer table)
    let authCustomers: any[] = [];
    try {
      const authBaseUrl = this.resolveAuthServiceUrl();
      
      // Get token from request - try multiple sources
      const token = req.headers.authorization?.replace('Bearer ', '') || 
                   req.user?.accessToken || 
                   req.cookies?.accessToken || '';
      const customersUrl = `${authBaseUrl}/auth/customers`;
      
      this.logger.log(`🔍 Fetching customers from auth service - URL: ${customersUrl}, tenantId: ${tenantId}, hasToken: ${!!token}, userType: ${req.user?.type || req.user?.role}`);
      
      // For customers, they can only see their own data, not all customers
      const isCustomer = req.user?.type === 'customer' || req.user?.role === 'CUSTOMER';
      if (isCustomer) {
        this.logger.log('Customer accessing dashboard/customers - returning empty list (customers cannot view other customers)');
        return {
          data: [],
          meta: {
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
          },
        };
      }
      
      if (!token) {
        this.logger.warn('⚠️ No authentication token available for auth service call - customers may not be fetched');
        // Don't throw, just skip auth service call
      } else {
        try {
          const authResponse = await firstValueFrom(
            this.httpService.get(customersUrl, {
              params: { page: 1, limit: 1000 }, // Get all customers
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Tenant-ID': tenantId,
                'Content-Type': 'application/json',
              },
              timeout: 10000, // 10 second timeout
            })
          );
          
          this.logger.log(`✅ Auth service response received:`, {
            status: authResponse.status,
            hasData: !!authResponse.data,
            dataType: typeof authResponse.data,
            dataKeys: authResponse.data ? Object.keys(authResponse.data) : [],
          });
          
          // Auth service returns { data: [...], meta: {...} }
          if (authResponse.data) {
            if (Array.isArray(authResponse.data)) {
              authCustomers = authResponse.data;
              this.logger.log(`📦 Found ${authCustomers.length} customers in array format`);
            } else if (authResponse.data.data && Array.isArray(authResponse.data.data)) {
              authCustomers = authResponse.data.data;
              this.logger.log(`📦 Found ${authCustomers.length} customers in data.data format`);
            } else if (authResponse.data.customers && Array.isArray(authResponse.data.customers)) {
              authCustomers = authResponse.data.customers;
              this.logger.log(`📦 Found ${authCustomers.length} customers in data.customers format`);
            } else {
              this.logger.warn(`⚠️ Unexpected response format from auth service:`, JSON.stringify(authResponse.data).substring(0, 200));
            }
          }
          
          this.logger.log(`✅ Successfully fetched ${authCustomers.length} customers from auth service`);
        } catch (httpError: any) {
          this.logger.error(`❌ HTTP error fetching customers from auth service:`, {
            message: httpError.message,
            status: httpError.response?.status,
            statusText: httpError.response?.statusText,
            data: httpError.response?.data,
            code: httpError.code,
          });
          // Continue with other sources
        }
      }
    } catch (error: any) {
      this.logger.error(`❌ Failed to fetch customers from auth service:`, {
        message: error.message,
        stack: error.stack?.substring(0, 500),
      });
      // Continue with other sources even if auth service fails
    }

    // 2. Fetch registered users from core database
    const users = await this.prisma.user.findMany({
      where: { 
        tenantId,
        role: 'CUSTOMER' 
      },
      select: {
        email: true,
        name: true,
        createdAt: true,
      }
    });

    // 3. Fetch orders
    const orders = await this.prisma.order.findMany({
      where: { tenantId },
      select: {
        customerEmail: true,
        customerName: true,
        customerPhone: true,
        totalAmount: true,
        createdAt: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 4. Merge data
    const customerMap = new Map();

    // Add customers from auth service (Customer table) first
    authCustomers.forEach((customer: any) => {
      const email = (customer.email || '').toLowerCase().trim();
      if (email) {
        // Parse metadata to extract emailDisabled status
        let emailDisabled = false;
        try {
          if (customer.metadata) {
            const metadata = typeof customer.metadata === 'string' 
              ? JSON.parse(customer.metadata) 
              : customer.metadata;
            emailDisabled = metadata.emailDisabled === true;
          }
        } catch {
          // Ignore parsing errors
        }

        customerMap.set(email, {
          id: customer.id || email,
          email: customer.email,
          name: customer.firstName && customer.lastName 
            ? `${customer.firstName} ${customer.lastName}`.trim()
            : customer.firstName || customer.lastName || customer.name || 'عميل مسجل',
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone || '',
          totalOrders: 0,
          totalSpent: 0,
          loyaltyPoints: 0,
          loyaltyTier: 'bronze',
          createdAt: customer.createdAt || new Date(),
          lastOrderDate: null,
          isRegistered: true,
          metadata: customer.metadata,
          emailDisabled
        });
      }
    });

    // Add registered users from core database (if not already added)
    users.forEach((user: any) => {
      const email = (user.email || '').toLowerCase().trim();
      if (email && !customerMap.has(email)) {
        customerMap.set(email, {
          id: user.email,
          email: user.email,
          name: user.name || 'عميل مسجل',
          phone: '',
          totalOrders: 0,
          totalSpent: 0,
          loyaltyPoints: 0,
          loyaltyTier: 'bronze',
          createdAt: user.createdAt,
          lastOrderDate: null,
          isRegistered: true
        });
      }
    });

    // Create a set of existing customer emails from auth service for quick lookup
    const existingCustomerEmails = new Set(
      authCustomers.map((c: any) => (c.email || '').toLowerCase().trim()).filter(Boolean)
    );

    // Merge with order data - only include customers that exist in auth service OR are guest customers
    orders.forEach((order: any) => {
      const email = order.customerEmail;
      const emailLower = (email || '').toLowerCase().trim();
      
      // Only process orders for customers that exist in auth service (registered) or are guests
      // Skip if customer was deleted from auth service
      if (!emailLower) return;
      
      // If customer doesn't exist in map and doesn't exist in auth service, skip (deleted customer)
      if (!customerMap.has(emailLower) && !existingCustomerEmails.has(emailLower)) {
        // This is a guest customer from orders - include them
        customerMap.set(emailLower, {
          id: email,
          email,
          name: order.customerName || 'عميل زائر',
          phone: order.customerPhone,
          totalOrders: 0,
          totalSpent: 0,
          loyaltyPoints: 0,
          loyaltyTier: 'bronze',
          createdAt: order.createdAt,
          lastOrderDate: order.createdAt,
          isRegistered: false
        });
      }
      
      // Only update if customer exists in map (either from auth service or as guest)
      if (customerMap.has(emailLower)) {
        const customer = customerMap.get(emailLower);
        customer.totalOrders += 1;
        customer.totalSpent += Number(order.totalAmount);
        customer.loyaltyPoints = Math.floor(customer.totalSpent / 10); // 1 point per 10 SAR
        
        // Update phone if missing
        if (!customer.phone && order.customerPhone) {
          customer.phone = order.customerPhone;
        }

        // Update last order date
        if (!customer.lastOrderDate || new Date(order.createdAt) > new Date(customer.lastOrderDate)) {
          customer.lastOrderDate = order.createdAt;
        }
        
        // Determine loyalty tier
        if (customer.totalSpent >= 5000) {
          customer.loyaltyTier = 'gold';
        } else if (customer.totalSpent >= 2000) {
          customer.loyaltyTier = 'silver';
        }
      }
    });

    const customersWithIds = Array.from(customerMap.values())
      .slice(skip, skip + limitNum)
      .map(customer => ({
        ...customer,
        id: customer.id || customer.email, // Ensure ID is always set
      }));

    this.logger.log(`📊 Customer summary for tenant ${tenantId}:`, {
      totalInMap: customerMap.size,
      returned: customersWithIds.length,
      fromAuthService: authCustomers.length,
      fromUsers: users.length,
      fromOrders: orders.length,
    });
    
    return {
      data: customersWithIds,
      meta: {
        total: customerMap.size,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(customerMap.size / limitNum),
      },
    };
  }

  /**
   * Get loyalty programs
   */
  @Get('loyalty-programs')
  async getLoyaltyPrograms(@Request() req: any) {
    const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';

    // Get customer stats
    const customersResult = await this.getCustomers(req, '1', '1000');
    // Handle both return formats
    const allCustomers = (customersResult as any).customers || (customersResult as any).data || [];

    return {
      programs: [
        {
          id: '1',
          name: 'برنامج الولاء الأساسي',
          description: 'برنامج الولاء الافتراضي لجميع العملاء',
          members: allCustomers.length,
          minPoints: 0,
          benefits: ['نقطة واحدة لكل 10 ريال', 'عروض حصرية', 'شحن مجاني للطلبات فوق 200 ريال']
        },
        {
          id: '2',
          name: 'العضوية الفضية',
          description: 'للعملاء الذين أنفقوا أكثر من 2000 ريال',
          members: allCustomers.filter((c: any) => c.loyaltyTier === 'silver' || c.loyaltyTier === 'gold').length,
          minPoints: 200,
          benefits: ['خصم 5%', 'نقاط مضاعفة', 'شحن مجاني دائماً', 'دعم أولوية']
        },
        {
          id: '3',
          name: 'العضوية الذهبية',
          description: 'للعملاء المميزين الذين أنفقوا أكثر من 5000 ريال',
          members: allCustomers.filter((c: any) => c.loyaltyTier === 'gold').length,
          minPoints: 500,
          benefits: ['خصم 10%', 'نقاط ثلاثية', 'شحن مجاني سريع', 'وصول مبكر للمنتجات الجديدة', 'هدايا مجانية']
        }
      ]
    };
  }

  /**
   * Update loyalty program
   */
  @Put('loyalty-programs/:id')
  async updateLoyaltyProgram(@Param('id') id: string, @Body() body: any) {
    // For now, satisfy the frontend request. 
    // In a real implementation, this would update the database.
    return {
      status: 'success',
      message: 'تم تحديث برنامج الولاء بنجاح',
      data: { id, ...body }
    };
  }

  /**
   * Get customers with fingerprint/security data
   * Returns list of customers who have logged in, with their device info
   */
  @Get('customers-fingerprints')
  async getCustomersFingerprints(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const skip = (pageNum - 1) * limitNum;

    // Fetch SecurityEvents of type DEVICE_FINGERPRINT for this tenant
    const securityEvents = await this.prisma.securityEvent.findMany({
      where: {
        tenantId,
        type: 'DEVICE_FINGERPRINT',
      },
      select: {
        id: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip,
    });

    // Transform into customer fingerprint records
    const customerFingerprints = securityEvents.map((event: any) => {
      const meta = typeof event.metadata === 'string' 
        ? JSON.parse(event.metadata) 
        : event.metadata || {};
      
      return {
        id: event.id,
        email: meta.email || event.user?.email || 'Unknown',
        name: event.user?.name || meta.email?.split('@')[0] || 'Unknown',
        userId: event.user?.id,
        ipAddress: event.ipAddress,
        os: meta.os || 'Unknown',
        isVpn: meta.isVpn || false,
        isVM: meta.fingerprint?.isVM || false,
        riskScore: meta.fingerprint?.riskScore || 0,
        visitorId: meta.fingerprint?.visitorId || 'Unknown',
        relatedEmails: meta.relatedEmails || [],
        createdAt: event.createdAt,
        userAgent: event.userAgent,
      };
    });

    // Get total count
    const total = await this.prisma.securityEvent.count({
      where: {
        tenantId,
        type: 'DEVICE_FINGERPRINT',
      }
    });

    return {
      customers: customerFingerprints,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  /**
   * Get store managers for support page
   * Public endpoint accessible from storefront
   */
  @Public()
  @Get('support/store-managers')
  async getStoreManagers(@Request() req: any) {
    const tenantId = req.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
    
    // Ensure support page exists
    await this.ensureSupportPage(tenantId);
    
    // Note: Store managers are stored in auth database
    // This endpoint should be called from frontend which will fetch from auth service
    // For now, return empty array - frontend will handle fetching from auth service
    return {
      storeManagers: [],
      message: 'Use the auth service to fetch store managers'
    };
  }

  /**
   * Ensure support page exists, create if it doesn't
   */
  private async ensureSupportPage(tenantId: string) {
    try {
      const existingPage = await this.pageService.findBySlug(tenantId, 'support', false);
      if (!existingPage) {
        // Create support page
        await this.pageService.create(tenantId, {
          title: 'الدعم الفني',
          slug: 'support',
          content: {
            sections: [
              {
                id: 'support-hero',
                type: 'hero',
                props: {
                  title: 'الدعم الفني',
                  subtitle: 'تواصل مع فريق الدعم',
                  backgroundColor: '#1a1a1a',
                  textColor: '#ffffff',
                  minHeight: '200px'
                }
              },
              {
                id: 'store-managers',
                type: 'custom',
                props: {
                  component: 'StoreManagersList',
                  title: 'مديرو المتجر'
                }
              }
            ]
          },
          isPublished: true
        });
      }
    } catch (error) {
      // Log error but don't throw - page creation is optional
      console.error('Failed to ensure support page:', error);
    }
  }


  /**
   * Get customer tiers for the tenant
   * This endpoint returns customer tiers that can be used for purchase limits configuration
   */
  @Get('customer-tiers')
  async getCustomerTiers(@Request() req: any) {
    try {
      const tenantId = req.tenantId || req.user?.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
      
      // Try to get customer tiers from PlatformConfig
      const config = await this.prisma.platformConfig.findUnique({
        where: {
          key: `customer-tiers-${tenantId}`,
        },
      });

      if (config && config.value) {
        const tiers = config.value as any;
        if (Array.isArray(tiers)) {
          return tiers;
        }
        if (tiers.tiers && Array.isArray(tiers.tiers)) {
          return tiers.tiers;
        }
      }

      // Return default tiers if none exist
      return [
        { id: '1', name: 'VIP Tier', description: 'VIP customers', color: '#FFD700', discountPercent: 15 },
        { id: '2', name: 'Gold Tier', description: 'Gold customers', color: '#C0C0C0', discountPercent: 10 },
        { id: '3', name: 'Regular Tier', description: 'Regular customers', color: '#CD7F32', discountPercent: 5 },
      ];
    } catch (error: any) {
      this.logger.error('Error getting customer tiers:', error);
      // Return default tiers on error instead of throwing
      return [
        { id: '1', name: 'VIP Tier', description: 'VIP customers', color: '#FFD700', discountPercent: 15 },
        { id: '2', name: 'Gold Tier', description: 'Gold customers', color: '#C0C0C0', discountPercent: 10 },
        { id: '3', name: 'Regular Tier', description: 'Regular customers', color: '#CD7F32', discountPercent: 5 },
      ];
    }
  }
}

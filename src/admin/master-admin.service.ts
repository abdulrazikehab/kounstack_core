import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, Status, UserRole, TicketStatus, TicketPriority, TransactionStatus } from '@prisma/client';
import { CreateComplaintDto, UpdateComplaintDto } from './dto/complaint.dto';
import { TransactionService } from '../transaction/transaction.service';


import * as os from 'os';
import * as bcrypt from 'bcryptjs';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MasterAdminService {
  private readonly logger = new Logger(MasterAdminService.name);

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private transactionService: TransactionService,
  ) {}


  // ==================== SYSTEM HEALTH ====================

  async getSystemHealth() {
    // Get CPU usage
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = Math.round(((totalTick - totalIdle) / totalTick) * 100);
    
    // Get Memory usage
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = Math.round((usedMemory / totalMemory) * 100);
    
    // Get system uptime
    const uptime = os.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    // Get database stats
    const [tenantCount, userCount, orderCount] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.order.count(),
    ]);

    return {
      cpu: {
        usage: cpuUsage,
        cores: cpus.length,
      },
      memory: {
        usage: memoryUsage,
        total: Math.round(totalMemory / (1024 * 1024 * 1024)), // GB
        free: Math.round(freeMemory / (1024 * 1024 * 1024)), // GB
        used: Math.round(usedMemory / (1024 * 1024 * 1024)), // GB
      },
      uptime: {
        hours: uptimeHours,
        minutes: uptimeMinutes,
        formatted: `${uptimeHours}h ${uptimeMinutes}m`,
      },
      database: {
        tenants: tenantCount,
        users: userCount,
        orders: orderCount,
      },
      platform: os.platform(),
      hostname: os.hostname(),
    };
  }

  // ==================== PLATFORM OVERVIEW ====================
  
  async getPlatformOverview() {
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalTransactions,
      totalRevenue,
      activePaymentGateways,
      activePartners,
      totalUsers,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({
        _sum: { platformFee: true, amount: true },
        where: { status: 'COMPLETED' },
      }),
      this.prisma.paymentMethod.count({ where: { isActive: true } }),
      this.prisma.partner.count({ where: { isActive: true } }),
      this.prisma.user.count(),
    ]);

    // Get plan distribution
    const planDistribution = await this.prisma.tenant.groupBy({
      by: ['plan'],
      _count: true,
    });

    // Get recent activity
    const recentActivity = await this.prisma.auditLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
        inactive: totalTenants - activeTenants - suspendedTenants,
      },
      transactions: {
        total: totalTransactions,
        totalRevenue: totalRevenue._sum.amount || 0,
        platformFees: totalRevenue._sum.platformFee || 0,
      },
      planDistribution: planDistribution.map(p => ({
        plan: p.plan,
        count: p._count,
      })),
      activePaymentGateways,
      activePartners,
      totalUsers,
      recentActivity,
    };
  }

  async getPlatformStats(startDate?: Date, endDate?: Date) {
    const dateFilter = {
      ...(startDate && { gte: startDate }),
      ...(endDate && { lte: endDate }),
    };

    const [
      transactionStats,
      orderStats,
      tenantGrowth,
    ] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true, platformFee: true },
        where: { createdAt: dateFilter },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: true,
        _sum: { totalAmount: true },
        where: { createdAt: dateFilter },
      }),
      this.prisma.tenant.groupBy({
        by: ['createdAt'],
        _count: true,
        where: { createdAt: dateFilter },
      }),
    ]);

    return {
      transactions: transactionStats,
      orders: orderStats,
      tenantGrowth,
    };
  }

  // ==================== TENANT MANAGEMENT ====================

  async getAllTenants(filters?: {
    plan?: PlanType;
    status?: Status;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (filters?.plan) where.plan = filters.plan;
    if (filters?.status) where.status = filters.status;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { subdomain: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          users: { select: { id: true, email: true, role: true } },
          _count: {
            select: {
              products: true,
              orders: true,
              transactions: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      tenants,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTenantById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: true,
        products: { take: 50 },
        orders: { take: 50, orderBy: { createdAt: 'desc' } },
        transactions: { take: 50, orderBy: { createdAt: 'desc' } },
        paymentMethods: true,
        themes: true,
        webhookEndpoints: true,
        featureFlags: true,
        integrations: true,
        _count: {
          select: {
            products: true,
            orders: true,
            transactions: true,
            users: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async createTenant(data: {
    name: string;
    subdomain: string;
    plan?: PlanType;
    description?: string;
    ownerEmail: string;
    ownerPassword: string;
  }) {
    // Check if subdomain is available
    const existing = await this.prisma.tenant.findUnique({
      where: { subdomain: data.subdomain },
    });

    if (existing) {
      throw new BadRequestException('Subdomain already taken');
    }

    // Hash password before creating user
    const hashedPassword = await bcrypt.hash(data.ownerPassword, 12);

    // Create tenant and owner in a transaction
    const tenant = await this.prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name: data.name,
          subdomain: data.subdomain,
          plan: data.plan || 'STARTER',
          description: data.description,
        },
      });

      // Create owner user with hashed password
      await tx.user.create({
        data: {
          email: data.ownerEmail,
          password: hashedPassword,
          role: 'SHOP_OWNER',
          tenantId: newTenant.id,
          name: data.name + ' Owner', // Default name
        },
      });

      return newTenant;
    });

    this.logger.log(`Tenant created: ${tenant.id} - ${tenant.name}`);
    return tenant;
  }

  async updateTenant(id: string, data: {
    name?: string;
    nameAr?: string;
    subdomain?: string;
    plan?: PlanType;
    status?: Status;
    description?: string;
    descriptionAr?: string;
    settings?: any;
  }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // If changing subdomain, check availability
    if (data.subdomain && data.subdomain !== tenant.subdomain) {
      const existing = await this.prisma.tenant.findUnique({
        where: { subdomain: data.subdomain },
      });
      if (existing) {
        throw new BadRequestException('Subdomain already taken');
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    this.logger.log(`Tenant updated: ${id}`);
    return updated;
  }

  async suspendTenant(id: string, reason?: string) {
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    this.logger.warn(`Tenant suspended: ${id} - Reason: ${reason || 'N/A'}`);
    return tenant;
  }

  async activateTenant(id: string) {
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    this.logger.log(`Tenant activated: ${id}`);
    return tenant;
  }

  async deleteTenant(id: string) {
    try {
      // Check if tenant exists first
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { id },
      });

      if (!existingTenant) {
        // Idempotent delete: If it's already gone, just return success
        this.logger.warn(`Tenant ${id} already deleted or not found. Returning success.`);
        return { success: true, message: 'Tenant already deleted' };
      }

      // Soft delete by setting status to INACTIVE
      const tenant = await this.prisma.tenant.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });

      this.logger.warn(`Tenant deleted (soft): ${id}`);
      return tenant;
    } catch (error: any) {
      this.logger.error(`Failed to delete tenant ${id}:`, error);
      
      // Handle Prisma errors
      if (error?.code === 'P2025') {
        // Record not found during update - return success
        return { success: true, message: 'Tenant already deleted' };
      }
      
      throw new BadRequestException(`Failed to delete tenant: ${error?.message || 'Unknown error'}`);
    }
  }

  async changeTenantPlan(id: string, plan: PlanType) {
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { plan },
    });

    this.logger.log(`Tenant plan changed: ${id} -> ${plan}`);
    return tenant;
  }

  // ==================== PAYMENT GATEWAY MANAGEMENT ====================

  async getPaymentGateways(tenantId?: string) {
    // If no tenantId specified, return all gateways (for admin view)
    // If tenantId is specified, return gateways for that tenant + default gateways
    const where = tenantId 
      ? { OR: [{ tenantId }, { tenantId: 'default' }] }
      : {}; // Return all gateways for admin view
    
    const gateways = await this.prisma.paymentMethod.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, subdomain: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { gateways };
  }

  async createPaymentGateway(data: {
    tenantId?: string | null;
    provider: string;
    name: string;
    credentials?: any;
    settings?: any;
  }) {
    // Admin-created gateways use 'default' tenant for global gateways
    // This allows them to be shared across all tenants
    const gateway = await this.prisma.paymentMethod.create({
      data: {
        tenantId: data.tenantId || 'default', // 'default' for admin-created global gateways
        provider: data.provider as any,
        name: data.name,
        credentials: data.credentials,
        settings: data.settings,
        isActive: true,
      },
    });

    this.logger.log(`Payment gateway created: ${gateway.id} - ${gateway.name} (${data.tenantId || 'global'})`);
    return gateway;
  }

  async updatePaymentGateway(id: string, data: {
    name?: string;
    credentials?: any;
    settings?: any;
    isActive?: boolean;
  }) {
    const gateway = await this.prisma.paymentMethod.update({
      where: { id },
      data,
    });

    this.logger.log(`Payment gateway updated: ${id}`);
    return gateway;
  }

  async togglePaymentGateway(id: string) {
    const gateway = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: { isActive: !gateway.isActive },
    });

    this.logger.log(`Payment gateway toggled: ${id} - ${updated.isActive ? 'enabled' : 'disabled'}`);
    return updated;
  }

  async deletePaymentGateway(id: string) {
    await this.prisma.paymentMethod.delete({ where: { id } });
    this.logger.warn(`Payment gateway deleted: ${id}`);
    return { success: true };
  }

  async getPaymentGatewayStats(id: string) {
    const gateway = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    const stats = await this.prisma.transaction.groupBy({
      by: ['status'],
      where: { paymentProvider: gateway.provider as any },
      _count: true,
      _sum: { amount: true, platformFee: true },
    });

    return {
      gateway,
      stats,
    };
  }

  // ==================== PARTNER MANAGEMENT ====================

  async getAllPartners(filters?: {
    isActive?: boolean;
    search?: string;
  }) {
    const where: any = {};
    
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPartnerById(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) {
      throw new NotFoundException('Partner not found');
    }
    return partner;
  }

  async createPartner(data: {
    name: string;
    nameAr?: string;
    email: string;
    phone?: string;
    logo?: string;
    description?: string;
    descriptionAr?: string;
    website?: string;
    commissionType: 'PERCENTAGE' | 'FIXED';
    commissionValue: number;
    allowedFeatures?: string[];
    settings?: any;
  }) {
    const existing = await this.prisma.partner.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new BadRequestException('Partner with this email already exists');
    }

    const partner = await this.prisma.partner.create({
      data: {
        name: data.name,
        nameAr: data.nameAr,
        email: data.email,
        phone: data.phone,
        logo: data.logo,
        description: data.description,
        descriptionAr: data.descriptionAr,
        website: data.website,
        commissionType: data.commissionType as any,
        commissionValue: data.commissionValue,
        allowedFeatures: data.allowedFeatures || [],
        settings: data.settings,
      },
    });

    this.logger.log(`Partner created: ${partner.id} - ${partner.name}`);
    return partner;
  }

  async updatePartner(id: string, data: {
    name?: string;
    nameAr?: string;
    phone?: string;
    logo?: string;
    description?: string;
    descriptionAr?: string;
    website?: string;
    commissionType?: 'PERCENTAGE' | 'FIXED';
    commissionValue?: number;
    allowedFeatures?: string[];
    settings?: any;
    isActive?: boolean;
  }) {
    const partner = await this.prisma.partner.update({
      where: { id },
      data: data as any,
    });

    this.logger.log(`Partner updated: ${id}`);
    return partner;
  }

  async deletePartner(id: string) {
    await this.prisma.partner.delete({ where: { id } });
    this.logger.warn(`Partner deleted: ${id}`);
    return { success: true };
  }

  async getPartnerStats(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) {
      throw new NotFoundException('Partner not found');
    }

    // Add partner-specific statistics here
    // For now, return basic info
    return {
      partner,
      stats: {
        // Add relevant stats
      },
    };
  }

  // ==================== AUDIT LOGGING ====================

  async logAction(data: {
    userId: string;
    tenantId: string;
    userRole: UserRole;
    action: string;
    resource: string;
    resourceId?: string;
    changes?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.activityLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.userId,
        targetId: data.resourceId,
        action: data.action,
        details: {
          resource: data.resource,
          userRole: data.userRole,
          changes: data.changes,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      },
    });
  }

  // Get security events from SecurityEvent table
  async getSecurityEvents(filters?: {
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.action) where.type = { contains: filters.action }; // Map action to type
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {
        ...(filters.startDate && { gte: filters.startDate }),
        ...(filters.endDate && { lte: filters.endDate }),
      };
    }

    // Fetch from SecurityEvent table for security events
    const [logs, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tenant: {
            select: { name: true, subdomain: true }
          },
          user: {
            select: { email: true }
          }
        }
      }),
      this.prisma.securityEvent.count({ where }),
    ]);

    // Format logs to match frontend expectations
    const formattedLogs = logs.map(log => {
      // Parse metadata if it's a string (compatibility with app-auth)
      let metadata: any = log.metadata;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          metadata = {};
        }
      }

      return {
        id: log.id,
        action: log.type,
        details: log.description,
        ipAddress: log.ipAddress || '-',
        severity: log.severity,
        createdAt: log.createdAt,
        user: { email: log.user?.email || 'System' },
        tenant: log.tenant,
        metadata: {
          ...metadata,
          country: log.country,
          city: log.city,
          isVpn: log.isVpn,
          isp: log.isp,
          os: log.os,
          browser: log.browser,
          device: log.device
        },
      };
    });

    return {
      logs: formattedLogs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get audit logs from ActivityLog table (core backend uses activityLog)
  async getAuditLogs(filters?: {
    userId?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const skip = (page - 1) * limit;

      const where: any = {
        NOT: { action: 'ERROR' }, // Exclude ERROR actions (they're in error logs)
      };
      if (filters?.userId) where.actorId = filters.userId;
      if (filters?.action) {
        where.action = { contains: filters.action };
      }

      if (!this.prisma.activityLog) {
        return {
          logs: [],
          pagination: { total: 0, page, limit, totalPages: 0 },
        };
      }

      const [logs, total] = await Promise.all([
        this.prisma.activityLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            tenant: {
              select: { name: true, subdomain: true }
            }
          }
        }),
        this.prisma.activityLog.count({ where }),
      ]);

      const formattedLogs = logs.map((log: any) => {
        const details = typeof log.details === 'string' 
          ? (() => { try { return JSON.parse(log.details); } catch { return {}; } })()
          : log.details || {};
        
        return {
          id: log.id,
          action: log.action,
          resourceType: details.resourceType || details.resource || 'SYSTEM',
          resourceId: log.targetId || details.resourceId || '',
          details: typeof details === 'object' && details.message 
            ? details.message 
            : `${log.action} on ${details.resourceType || details.resource || 'system'}`,
          createdAt: log.createdAt,
          user: { 
            email: details.userEmail || 'System', 
            name: details.userName || details.actorName 
          },
          tenant: log.tenant,
          metadata: details,
        };
      });

      return {
        logs: formattedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Failed to fetch audit logs from core database:', error);
      return {
        logs: [],
        pagination: {
          total: 0,
          page: filters?.page || 1,
          limit: filters?.limit || 50,
          totalPages: 0,
        },
      };
    }
  }

  // Get error logs from ActivityLog table where action='ERROR'
  async getErrorLogs(filters?: {
    page?: number;
    limit?: number;
  }) {
    try {
      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const skip = (page - 1) * limit;

      const where: any = {
        action: 'ERROR',
      };

      if (!this.prisma.activityLog) {
        return {
          logs: [],
          pagination: { total: 0, page, limit, totalPages: 0 },
        };
      }

      const [logs, total] = await Promise.all([
        this.prisma.activityLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            tenant: {
              select: { name: true, subdomain: true }
            }
          }
        }),
        this.prisma.activityLog.count({ where }),
      ]);

      const formattedLogs = logs.map((log: any) => {
        const details = typeof log.details === 'string' 
          ? (() => { try { return JSON.parse(log.details); } catch { return {}; } })()
          : log.details || {};
        
        return {
          id: log.id,
          action: 'ERROR',
          resourceType: details.resourceType || 'SYSTEM',
          resourceId: log.targetId || details.statusCode || '',
          severity: details.severity || 'HIGH',
          details: details.message || 'System error',
          createdAt: log.createdAt,
          user: { 
            email: details.userEmail || 'System', 
            name: details.userName 
          },
          tenant: log.tenant,
          metadata: details,
        };
      });

      return {
        logs: formattedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Failed to fetch error logs from core database:', error);
      return {
        logs: [],
        pagination: {
          total: 0,
          page: filters?.page || 1,
          limit: filters?.limit || 50,
          totalPages: 0,
        },
      };
    }
  }
  // ==================== CUSTOMER MANAGEMENT ====================

  async getCustomers() {
    // Get all users (shop owners and staff who have storefronts)
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: ['SHOP_OWNER', 'STAFF'] }
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        tenant: {
          select: {
            name: true,
            subdomain: true,
            plan: true,
            status: true,
          }
        },
        securityEvents: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            ipAddress: true,
            isVpn: true,
            country: true,
            city: true,
            os: true,
            browser: true,
            device: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit to 100 for performance
    });

    // Format users for display
    const formattedCustomers = users.map((user) => {
      const latestEvent = user.securityEvents[0];
      return {
        id: user.id,
        email: user.email,
        name: user.name || '-',
        role: user.role,
        tenantName: user.tenant?.name || '-',
        tenantSubdomain: user.tenant?.subdomain || '-',
        tenantPlan: user.tenant?.plan || '-',
        tenantStatus: user.tenant?.status || '-',
        os: latestEvent?.os || 'Unknown',
        browser: latestEvent?.browser || 'Unknown',
        device: latestEvent?.device || 'Unknown',
        isVpn: latestEvent?.isVpn || false,
        ipAddress: latestEvent?.ipAddress || '-',
        lastLogin: latestEvent?.createdAt || user.createdAt,
        location: latestEvent?.city ? `${latestEvent.city}, ${latestEvent.country}` : (latestEvent?.country || '-')
      };
    });

    return formattedCustomers;
  }

  // ==================== PLANS MANAGEMENT ====================

  async getAllPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    // Get tenant counts for each plan
    const tenantCounts = await this.prisma.tenant.groupBy({
      by: ['plan'],
      _count: true,
    });

    const plansWithCounts = plans.map(plan => {
      const count = tenantCounts.find(c => c.plan === plan.code)?._count || 0;
      return { ...plan, _count: { tenants: count } };
    });

    return { plans: plansWithCounts };
  }

  async createPlan(data: any) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        code: data.name.toUpperCase().replace(/\s+/g, '_'),
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        price: data.price,
        currency: data.currency,
        billingCycle: data.billingCycle,
        features: data.features,
        featuresAr: data.featuresAr,
        limits: data.limits,
        isActive: data.isActive,
        isPopular: data.isPopular,
        sortOrder: data.sortOrder,
      },
    });
    return plan;
  }

  async updatePlan(id: string, data: any) {
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        price: data.price,
        currency: data.currency,
        billingCycle: data.billingCycle,
        features: data.features,
        featuresAr: data.featuresAr,
        limits: data.limits,
        isActive: data.isActive,
        isPopular: data.isPopular,
        sortOrder: data.sortOrder,
      },
    });
    return plan;
  }

  async togglePlan(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: { isActive: !plan.isActive },
    });
  }

  async deletePlan(id: string) {
    return this.prisma.subscriptionPlan.delete({ where: { id } });
  }

  // ==================== FEATURE CONTROL ====================

  async getAllFeatures() {
    const features = await this.prisma.platformFeature.findMany({
      orderBy: { category: 'asc' },
    });
    return { features };
  }

  async createFeature(data: any) {
    return this.prisma.platformFeature.create({
      data: {
        feature: data.feature,
        displayName: data.displayName,
        displayNameAr: data.displayNameAr,
        description: data.description,
        category: data.category,
        requiredPlan: data.requiredPlan,
        isGlobal: data.isGlobal,
        isEnabled: data.isEnabled,
        config: data.config,
      },
    });
  }

  async updateFeature(id: string, data: any) {
    return this.prisma.platformFeature.update({
      where: { id },
      data: {
        displayName: data.displayName,
        displayNameAr: data.displayNameAr,
        description: data.description,
        category: data.category,
        requiredPlan: data.requiredPlan,
        isGlobal: data.isGlobal,
        isEnabled: data.isEnabled,
        config: data.config,
      },
    });
  }

  async toggleFeature(id: string) {
    const feature = await this.prisma.platformFeature.findUnique({ where: { id } });
    if (!feature) throw new NotFoundException('Feature not found');

    return this.prisma.platformFeature.update({
      where: { id },
      data: { isEnabled: !feature.isEnabled },
    });
  }

  async getFeatureOverrides() {
    const overrides = await this.prisma.featureFlag.findMany({
      where: { tenantId: { not: null } },
      include: {
        tenant: {
          select: { name: true, subdomain: true },
        },
      },
    });

    return {
      overrides: overrides.map(o => ({
        id: o.id,
        tenantId: o.tenantId,
        feature: o.feature,
        enabled: o.enabled,
        tenantName: o.tenant?.name,
        tenantSubdomain: o.tenant?.subdomain,
        updatedAt: o.updatedAt,
      })),
    };
  }

  async createFeatureOverride(data: any) {
    // Check if override exists
    const existing = await this.prisma.featureFlag.findUnique({
      where: {
        tenantId_feature: {
          tenantId: data.tenantId,
          feature: data.feature,
        },
      },
    });

    if (existing) {
      return this.prisma.featureFlag.update({
        where: { id: existing.id },
        data: { enabled: data.enabled },
      });
    }

    return this.prisma.featureFlag.create({
      data: {
        tenantId: data.tenantId,
        feature: data.feature,
        enabled: data.enabled,
      },
    });
  }

  async deleteFeatureOverride(id: string) {
    return this.prisma.featureFlag.delete({ where: { id } });
  }

  // ==================== USER GIFTS ====================

  async getAllGifts() {
    const gifts = await this.prisma.userGift.findMany({
      include: {
        user: { select: { email: true, name: true } },
        tenant: { select: { name: true, subdomain: true } },
      },
      orderBy: { grantedAt: 'desc' },
    });
    return { gifts };
  }

  async grantGift(data: any) {
    const giftData: any = {
      giftType: data.giftType,
      giftValue: data.giftValue,
      status: 'ACTIVE',
      grantedBy: 'SYSTEM_ADMIN', // TODO: Get actual admin user
      message: data.message,
    };

    if (data.targetType === 'user') {
      giftData.userId = data.targetId;
    } else {
      giftData.tenantId = data.targetId;
    }

    if (data.duration && data.duration > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + data.duration);
      giftData.expiresAt = expiresAt;
    }

    const gift = await this.prisma.userGift.create({
      data: giftData,
    });

    // Apply the gift effect immediately
    if (data.giftType === 'PLAN_UPGRADE' && data.targetType === 'tenant') {
      await this.prisma.tenant.update({
        where: { id: data.targetId },
        data: { plan: data.giftValue as PlanType },
      });
    }

    return gift;
  }

  async revokeGift(id: string) {
    const gift = await this.prisma.userGift.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    // Revert effect if possible (complex logic, simplified here)
    // For now just mark as revoked
    
    return gift;
  }

  async getAllUsers(limit: number = 100) {
    const users = await this.prisma.user.findMany({
      take: limit,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        tenant: {
          select: {
            name: true,
            subdomain: true,
            plan: true,
          },
        },
      },
    });
    return { users };
  }

  // ==================== AI CONFIGURATION ====================

  async getGlobalAiScript() {
    try {
      const config = await this.prisma.platformConfig.findUnique({
        where: { key: 'GLOBAL_AI_SCRIPT' },
      });
      
      if (!config) return { script: '' };
      
      // Handle both object format { script: "..." } and direct string format
      if (typeof config.value === 'string') {
        return { script: config.value };
      }
      
      return { script: (config.value as any)?.script || '' };
    } catch (error: any) {
      this.logger.error('Error getting global AI script:', error);
      // Return empty script on error rather than throwing
      return { script: '' };
    }
  }

  async updateGlobalAiScript(script: string) {
    try {
      return await this.prisma.platformConfig.upsert({
        where: { key: 'GLOBAL_AI_SCRIPT' },
        update: {
          value: { script },
          updatedAt: new Date(),
        },
        create: {
          key: 'GLOBAL_AI_SCRIPT',
          value: { script },
          description: 'Global AI training script for the assistant',
          category: 'AI_CONFIGURATION',
          isEditable: true,
        },
      });
    } catch (error: any) {
      this.logger.error('Error updating global AI script:', error);
      this.logger.error('Error details:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        meta: error?.meta,
      });
      throw new BadRequestException(`Failed to update AI script: ${error?.message || 'Unknown error'}`);
    }
  }

  // ==================== DATABASE MANAGEMENT ====================

  async resetDatabase() {
    try {
      // Delete data in reverse order of dependencies
      await this.prisma.orderItem.deleteMany();
      await this.prisma.order.deleteMany();
      await this.prisma.cartItem.deleteMany();
      await this.prisma.cart.deleteMany();
      await this.prisma.productImage.deleteMany();
      await this.prisma.product.deleteMany();
      await this.prisma.category.deleteMany();
      
      await this.prisma.transaction.deleteMany();
      await this.prisma.paymentMethod.deleteMany();
      
      await this.prisma.auditLog.deleteMany();
      await this.prisma.activityLog.deleteMany();
      await this.prisma.securityEvent.deleteMany();
      
      // Delete users and tenants
      await this.prisma.user.deleteMany();
      await this.prisma.tenant.deleteMany();
      await this.prisma.partner.deleteMany();

      this.logger.warn('Database reset performed by Master Admin');
      return { success: true, message: 'All data has been cleared' };
    } catch (error: unknown) {
      this.logger.error('Failed to reset database', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException('Failed to reset database: ' + errorMessage);
    }
  }

  async clearNonTransactionData() {
    try {
      // Clears products, categories, logs, but NOT transactions or payment records
      await this.prisma.productImage.deleteMany();
      await this.prisma.product.deleteMany();
      await this.prisma.category.deleteMany();
      await this.prisma.cartItem.deleteMany();
      await this.prisma.cart.deleteMany();
      
      await this.prisma.auditLog.deleteMany();
      await this.prisma.activityLog.deleteMany();
      await this.prisma.securityEvent.deleteMany();

      this.logger.warn('Non-transactional data clearing performed by Master Admin');
      return { success: true, message: 'Products, categories and logs cleared. Transactions were preserved.' };
    } catch (error: unknown) {
      this.logger.error('Failed to clear non-transaction data', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException('Failed to clear data: ' + errorMessage);
    }
  }

  // ==================== ADMIN API KEY MANAGEMENT ====================

  async getAdminApiKey() {
    try {
      // SECURITY FIX: Get from Tenant settings (system tenant)
      const systemTenant = await this.prisma.tenant.findUnique({
        where: { id: 'system' },
        select: { settings: true },
      });

      if (systemTenant?.settings && typeof systemTenant.settings === 'object') {
        const settings = systemTenant.settings as any;
        if (settings.adminApiKey && typeof settings.adminApiKey === 'string') {
          return { apiKey: settings.adminApiKey };
        }
      }

      // SECURITY FIX: No fallback - require environment variable
      const envKey = process.env.ADMIN_API_KEY;
      if (!envKey) {
        this.logger.error('ADMIN_API_KEY is not configured in environment or database');
        throw new Error('ADMIN_API_KEY is not configured');
      }

      // Warn about insecure keys but don't throw - internal services need the key to function
      if (envKey === 'Koun2025Admin!' || envKey === 'Kawn2025Admin!' || envKey === 'Saeaa2025Admin!' || envKey.length < 20) {
        this.logger.warn('⚠️ ADMIN_API_KEY is using insecure default or too short. Please update it.');
        return { apiKey: envKey, insecure: true };
      }

      return { apiKey: envKey };
    } catch (error) {
      this.logger.error('Failed to get admin API key:', error);
      throw error;
    }
  }

  async setAdminApiKey(apiKey: string) {
    try {
      // SECURITY FIX: Validate API key strength
      if (!apiKey || typeof apiKey !== 'string') {
        throw new BadRequestException('API key must be a non-empty string');
      }

      if (apiKey.length < 20) {
        throw new BadRequestException('API key must be at least 20 characters long');
      }

      if (apiKey === 'Koun2025Admin!' || apiKey === 'Kawn2025Admin!' || apiKey === 'Saeaa2025Admin!') {
        throw new BadRequestException('Cannot use default API key. Please choose a strong, unique key.');
      }

      // SECURITY FIX: Store in Tenant settings (system tenant)
      // First, ensure system tenant exists
      let systemTenant = await this.prisma.tenant.findUnique({
        where: { id: 'system' },
      });

      if (!systemTenant) {
        // Create system tenant if it doesn't exist
        systemTenant = await this.prisma.tenant.create({
          data: {
            id: 'system',
            name: 'System',
            subdomain: 'system',
            settings: {
              adminApiKey: apiKey,
            },
          },
        });
        this.logger.log('System tenant created with admin API key');
      } else {
        // Update existing system tenant
        const currentSettings = (systemTenant.settings as any) || {};
        const updatedSettings = {
          ...currentSettings,
          adminApiKey: apiKey,
        };

        await this.prisma.tenant.update({
          where: { id: 'system' },
          data: {
            settings: updatedSettings,
          },
        });
        this.logger.log('Admin API key updated in system tenant');
      }

      // SECURITY FIX: Invalidate cache in AdminApiKeyGuard
      // The guard will refresh on next request (cache TTL is 1 minute)
      // For immediate invalidation, we could use Redis or shared cache
      
      this.logger.warn(`Admin API key updated. New key length: ${apiKey.length}, prefix: ${apiKey.substring(0, 8)}...`);
      
      // Return success with key info (first 8 chars only for security)
      return { 
        success: true, 
        message: 'Admin API key updated successfully',
        keyPrefix: apiKey.substring(0, 8) + '...',
        keyLength: apiKey.length
      };
    } catch (error) {
      this.logger.error('Failed to set admin API key:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to set admin API key');
    }
  }

  // ==================== PAGE CONTENT MANAGEMENT ====================

  async updatePageContent(slug: string, content: any) {
    const key = `page_${slug}`;
    
    // Check if config exists
    const existing = await this.prisma.platformConfig.findUnique({
      where: { key },
    });

    if (existing) {
      return this.prisma.platformConfig.update({
        where: { key },
        data: {
          value: content,
          updatedAt: new Date(),
          updatedBy: 'admin',
        },
      });
    } else {
      return this.prisma.platformConfig.create({
        data: {
          key,
          value: content,
          category: 'pages',
          updatedBy: 'admin',
        },
      });
    }
  }

  // ==================== PLATFORM CONFIGURATION ====================

  async getPlatformConfig() {
    const config = await this.prisma.platformConfig.findUnique({
      where: { key: 'platform_details' },
    });

    if (config) {
      return config.value as any;
    }

    // Return defaults if no config exists
    return {
      name: 'SAEA',
      nameAr: 'ساعي',
      email: '',
      phone: '',
      whatsapp: '',
      address: '',
      addressAr: '',
      logoUrl: '',
      socialLinks: {},
      settings: {
        environmentMode: 'production', // production, testing, maintenance
        specialEvents: {
          ramadan: false,
          eid: false,
          backToSchool: false,
        },
        rateLimitLevel: 'normal', // normal, strict, relaxed
        allowSignups: true,
        allowLogins: true,
      },
      celebrations: {
        items: [
          { id: 'ramadan', enabled: true, titleAr: 'رمضان مبارك', titleEn: 'Ramadan Mubarak', messageAr: 'كل عام وأنتم بخير. نتمنى لكم شهراً مباركاً من فريق كون.', messageEn: 'Wishing you a blessed month from the Koun team.', imageUrl: '', animationUrl: '' },
          { id: 'eid', enabled: true, titleAr: 'عيد مبارك', titleEn: 'Eid Mubarak', messageAr: 'كل عام وأنتم بخير.', messageEn: 'Wishing you joy and prosperity.', imageUrl: '', animationUrl: '' },
        ],
      },
    };
  }

  async updatePlatformConfig(data: any) {
    const existingConfig = await this.prisma.platformConfig.findUnique({
      where: { key: 'platform_details' },
    });

    const existingValue = (existingConfig?.value as Record<string, unknown>) || {};
    const merged = { ...existingValue, ...data };

    if (existingConfig) {
      return this.prisma.platformConfig.update({
        where: { key: 'platform_details' },
        data: {
          value: merged,
          updatedAt: new Date(),
          updatedBy: 'admin',
        },
      });
    }
    return this.prisma.platformConfig.create({
      data: {
        key: 'platform_details',
        value: merged,
        category: 'platform',
        updatedBy: 'admin',
      },
    });
  }


  // ==================== LIMITS CONFIGURATION ====================

  async getLimitsConfig() {
    const config = await this.prisma.platformConfig.findUnique({
      where: { key: 'limits_config' },
    });

    if (config) {
      return config.value as any;
    }

    // Return defaults if no config exists
    return {
      signupEnabled: true,
      signinEnabled: true,
      signupMaxAttempts: 3,
      signupWindowMs: 60 * 60 * 1000, // 1 hour
      signinMaxAttempts: 5,
      signinWindowMs: 15 * 60 * 1000, // 15 minutes
      maxStoresPerUser: 2,
    };
  }

  async updateLimitsConfig(data: {
    signupEnabled?: boolean;
    signinEnabled?: boolean;
    signupMaxAttempts?: number;
    signupWindowMs?: number;
    signinMaxAttempts?: number;
    signinWindowMs?: number;
    maxStoresPerUser?: number;
  }) {
    const existingConfig = await this.prisma.platformConfig.findUnique({
      where: { key: 'limits_config' },
    });

    const currentConfig = existingConfig 
      ? (existingConfig.value as any)
      : {
          signupEnabled: true,
          signinEnabled: true,
          signupMaxAttempts: 3,
          signupWindowMs: 60 * 60 * 1000,
          signinMaxAttempts: 5,
          signinWindowMs: 15 * 60 * 1000,
          maxStoresPerUser: 2,
        };

    const updatedConfig = {
      ...currentConfig,
      ...data,
    };

    if (existingConfig) {
      await this.prisma.platformConfig.update({
        where: { key: 'limits_config' },
        data: { 
          value: updatedConfig,
          updatedAt: new Date(),
          updatedBy: 'admin',
        },
      });
    } else {
      await this.prisma.platformConfig.create({
        data: {
          key: 'limits_config',
          value: updatedConfig,
          category: 'system',
          updatedBy: 'admin',
        },
      });
    }

    this.logger.log('Limits configuration updated:', updatedConfig);
    return updatedConfig;
  }

  // ==================== CLOUDINARY ACCESS MANAGEMENT ====================

  /** Auth app uses global prefix "auth", so base must end with /auth when using port-only URL. */
  private getAuthServiceBaseUrl(): string {
    const raw = (process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');
    if (raw.includes('/auth') || raw.endsWith('/auth')) return raw;
    return `${raw}/auth`;
  }

  async getCloudinaryAccessUsers() {
    try {
      const authBase = this.getAuthServiceBaseUrl();
      const url = `${authBase}/admin/cloudinary-access`;
      
      // SECURITY FIX: Get admin API key from database or environment (no fallback)
      const adminApiKeyData = await this.getAdminApiKey();
      const adminApiKey = adminApiKeyData.apiKey;
      this.logger.log(`Calling auth service: ${url} with admin API key`);
      
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'x-admin-api-key': adminApiKey,
            'X-Admin-API-Key': adminApiKey, // Also send with capital letters for compatibility
          },
        })
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to get Cloudinary access users:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
      });
      throw new BadRequestException(
        error.response?.data?.message || error.message || 'Failed to get Cloudinary access users'
      );
    }
  }

  async updateCloudinaryAccess(userIds: string[], hasAccess: boolean, grantedBy: string) {
    try {
      const authBase = this.getAuthServiceBaseUrl();
      const url = `${authBase}/admin/cloudinary-access`;
      
      // SECURITY FIX: Get admin API key from database or environment (no fallback)
      const adminApiKeyData = await this.getAdminApiKey();
      const adminApiKey = adminApiKeyData.apiKey;
      
      const response = await firstValueFrom(
        this.httpService.post(url, {
          userIds,
          hasAccess,
          grantedBy,
        }, {
          headers: {
            'x-admin-api-key': adminApiKey,
            'X-Admin-API-Key': adminApiKey, // Also send with capital letters for compatibility
          },
        })
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to update Cloudinary access:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
        userIds,
        hasAccess,
        grantedBy,
      });
      throw new BadRequestException(
        error.response?.data?.message || error.message || 'Failed to update Cloudinary access'
      );
    }
  }

  async getUserCloudinaryAccess(userId: string) {
    try {
      const authBase = this.getAuthServiceBaseUrl();
      const url = `${authBase}/admin/cloudinary-access/${userId}`;
      
      // SECURITY FIX: Get admin API key from database or environment (no fallback)
      const adminApiKeyData = await this.getAdminApiKey();
      const adminApiKey = adminApiKeyData.apiKey;
      
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'x-admin-api-key': adminApiKey,
            'X-Admin-API-Key': adminApiKey, // Also send with capital letters for compatibility
          },
        })
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to get user Cloudinary access:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
      });
      throw new BadRequestException(
        error.response?.data?.message || error.message || 'Failed to get user Cloudinary access'
      );
    }
  }

  // ==================== COMPLAINTS MANAGEMENT ====================

  async getAllComplaints(options: {
    status?: TicketStatus;
    priority?: TicketPriority;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, priority, search, page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.complaint.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getComplaintById(id: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
    });

    if (!complaint) {
      throw new NotFoundException(`Complaint with ID ${id} not found`);
    }

    return complaint;
  }

  async createComplaint(data: CreateComplaintDto) {
    return this.prisma.complaint.create({
      data,
    });
  }

  async updateComplaint(id: string, data: UpdateComplaintDto) {
    await this.getComplaintById(id);

    return this.prisma.complaint.update({
      where: { id },
      data,
    });
  }

  async deleteComplaint(id: string) {
    await this.getComplaintById(id);

    return this.prisma.complaint.delete({
      where: { id },
    });
  }

  // ==================== TRANSACTION MANAGEMENT ====================

  async getAllTransactions(filters: {
    status?: TransactionStatus;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      total,
    };
  }

  async refundTransaction(transactionId: string) {
    // Find the transaction first to get the tenantId
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.transactionService.refundTransaction(transaction.tenantId, transactionId);
  }

  // ==================== VERSIONS MANAGEMENT ====================

  async getAllVersions() {
    try {
      const versions = await this.prisma.systemVersion.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return versions;
    } catch (error) {
      // If the table doesn't exist yet, return default versions
      this.logger.warn('SystemVersion table may not exist, returning defaults');
      return [
        {
          id: 'default',
          name: 'Standard Admin',
          description: 'Default view for system administrators',
          versionCode: 'v1',
          visibleTabs: ['dashboard', 'overview', 'tenants', 'users', 'plans', 'features', 'ai', 'gifts', 'gateways', 'partners', 'api-keys', 'pages', 'database', 'customers', 'permissions', 'complaints', 'platform-settings', 'transactions', 'cloudinary', 'analytics', 'limits', 'supplier-products', 'versions', 'logs'],
          visibleTenantTabs: ['dashboard', 'products', 'orders', 'customers', 'settings', 'reports', 'marketing'],
          enabledFeatures: ['all'],
          isActive: true,
          isDefault: true,
          createdAt: new Date(),
        },
      ];
    }
  }

  async getVersionById(id: string) {
    try {
      const version = await this.prisma.systemVersion.findUnique({ where: { id } });
      if (!version) {
        throw new NotFoundException('Version not found');
      }
      return version;
    } catch (error) {
      throw new NotFoundException('Version not found');
    }
  }

  async createVersion(data: {
    name: string;
    description?: string;
    versionCode: string;
    visibleTabs: string[];
    visibleTenantTabs: string[];
    enabledFeatures: string[];
    isActive?: boolean;
    isDefault?: boolean;
  }) {
    try {
      // If this is set as default, unset other defaults
      if (data.isDefault) {
        await this.prisma.systemVersion.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      return this.prisma.systemVersion.create({
        data: {
          name: data.name,
          description: data.description,
          versionCode: data.versionCode,
          visibleTabs: data.visibleTabs,
          visibleTenantTabs: data.visibleTenantTabs,
          enabledFeatures: data.enabledFeatures,
          isActive: data.isActive ?? true,
          isDefault: data.isDefault ?? false,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create version', error);
      throw new BadRequestException('Failed to create version');
    }
  }

  async updateVersion(id: string, data: {
    name?: string;
    description?: string;
    versionCode?: string;
    visibleTabs?: string[];
    visibleTenantTabs?: string[];
    enabledFeatures?: string[];
    isActive?: boolean;
    isDefault?: boolean;
  }) {
    try {
      // If this is set as default, unset other defaults
      if (data.isDefault) {
        await this.prisma.systemVersion.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return this.prisma.systemVersion.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.logger.error('Failed to update version', error);
      throw new NotFoundException('Version not found or update failed');
    }
  }

  async deleteVersion(id: string) {
    try {
      // Don't delete if it's the default
      const version = await this.prisma.systemVersion.findUnique({ where: { id } });
      if (version?.isDefault) {
        throw new BadRequestException('Cannot delete the default version');
      }

      await this.prisma.systemVersion.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to delete version', error);
      throw new BadRequestException('Failed to delete version');
    }
  }
}


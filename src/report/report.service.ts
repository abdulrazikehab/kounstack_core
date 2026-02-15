import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getDefaultCurrency } from '../common/utils/currency.util';

@Injectable()
export class ReportService {
  constructor(private prisma: PrismaService) {}

  async overview(tenantId: string) {
    if (!tenantId) {
      return { totalOrders: 0, revenue: 0, totalTransactions: 0, activityCount: 0 };
    }
    try {
      const totalOrders = await this.prisma.order.count({
        where: { tenantId, paymentStatus: 'SUCCEEDED' },
      });
      const revenue = await this.prisma.order.aggregate({
        where: { tenantId, paymentStatus: 'SUCCEEDED' },
        _sum: { totalAmount: true },
      });
      // Access transaction model via getter in PrismaService
      const totalTransactions = await this.prisma.transaction.count({
        where: { tenantId, status: 'COMPLETED' },
      });
      const activity = await this.prisma.activityLog.count({
        where: { tenantId },
      });
      
      // Round revenue to 2 decimal places for precision
      const roundCurrency = (value: number): number => Math.round(value * 100) / 100;
      
      return {
        totalOrders,
        revenue: roundCurrency(Number(revenue._sum.totalAmount ?? 0)),
        totalTransactions,
        activityCount: activity,
      };
    } catch (error: any) {
      // If tenant doesn't exist, return empty stats
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return { totalOrders: 0, revenue: 0, totalTransactions: 0, activityCount: 0 };
      }
      throw error;
    }
  }

  async getProductReport(tenantId: string, page: number = 1, limit: number = 20, search?: string) {
    if (!tenantId) {
      return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    }
    try {
      // Build where clause with optional search
      const where: any = { tenantId };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Get total count first
      const total = await this.prisma.product.count({ where });

      const products = await this.prisma.product.findMany({
        where,
        include: {
          variants: {
            select: {
              inventoryQuantity: true
            }
          },
          orderItems: {
            where: {
              order: {
                paymentStatus: 'SUCCEEDED' // Only count completed orders
              }
            },
            select: {
              quantity: true,
              price: true
            }
          }
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      // Helper function to round currency to 2 decimal places
      const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

      const data = products.map((p: any) => {
        // Calculate total stock from variants (inventoryQuantity field)
        const totalStock = p.variants?.reduce((sum: number, v: any) => sum + (Number(v.inventoryQuantity || 0)), 0) || 0;
        
        // Calculate sales count and revenue with precision
        const salesCount = p.orderItems.reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0);
        const revenue = roundCurrency(
          p.orderItems.reduce((acc: number, item: any) => {
            const itemRevenue = Number(item.price || 0) * Number(item.quantity || 0);
            return acc + itemRevenue;
          }, 0)
        );
        
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock: totalStock,
          salesCount,
          revenue
        };
      });

      return {
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      // If tenant doesn't exist, return empty response
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
      }
      throw error;
    }
  }

  async getCustomerReport(tenantId: string) {
    if (!tenantId) {
      return [];
    }
    try {
      // Get all users with CUSTOMER role for this tenant
      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          role: 'CUSTOMER',
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });

      // Get order statistics for each customer
      const customerEmails = users.map(u => u.email).filter(Boolean);
      
      // Get order stats grouped by customer email
      const orderStats = await this.prisma.order.groupBy({
        by: ['customerEmail'],
        where: {
          tenantId,
          customerEmail: { in: customerEmails },
          paymentStatus: 'SUCCEEDED',
        },
        _count: { id: true },
        _sum: { totalAmount: true },
        _max: { createdAt: true },
      });

      // Create a map of email -> stats
      const statsMap = new Map(
        orderStats.map((stat: any) => [
          stat.customerEmail,
          {
            orders: stat._count.id,
            totalSpent: Number(stat._sum.totalAmount ?? 0),
            lastOrderDate: stat._max.createdAt,
          },
        ])
      );

      // Round currency to 2 decimal places for precision
      const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

      // Combine user data with order stats
      return users.map((user: any) => {
        const stats = (statsMap.get(user.email) as any) || {
          orders: 0,
          totalSpent: 0,
          lastOrderDate: null,
        };

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email?.split('@')[0] || 'Unknown',
          phone: user.phone || '',
          region: '',
          address: '',
          status: 'active',
          tier: 'C',
          role: user.role || 'CUSTOMER',
          activityType: 'other',
          lastRechargeDate: stats.lastOrderDate ? new Date(stats.lastOrderDate).toISOString() : null,
          accountManager: '',
          totalSpent: roundCurrency(stats.totalSpent),
          ordersCount: stats.orders,
          orders: stats.orders,
          createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
        };
      }).sort((a: any, b: any) => b.totalSpent - a.totalSpent);
    } catch (error: any) {
      // If tenant doesn't exist, return empty array
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return [];
      }
      throw error;
    }
  }

  async getPaymentReport(tenantId: string) {
    if (!tenantId) {
      return [];
    }
    try {
      const transactions = await this.prisma.transaction.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });

      return transactions.map((t: any) => ({
        id: t.id,
        transactionId: t.transactionId || t.id,
        amount: Number(t.amount || 0),
        currency: t.currency || 'SAR',
        status: t.status,
        method: t.paymentMethodType || t.paymentProvider || 'System',
        provider: t.paymentProvider,
        orderId: t.orderId || t.orderNumber || 'N/A',
        customerName: t.customerName || 'Unknown',
        customerEmail: t.customerEmail || 'Unknown',
        customerRole: 'CUSTOMER',
        createdAt: t.createdAt,
        type: 'PAYMENT',
      }));
    } catch (error: any) {
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return [];
      }
      throw error;
    }
  }

  async getSalesReport(tenantId: string, startDate?: Date, endDate?: Date) {
    if (!tenantId) {
      return {
        totalSales: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        byDate: [],
      };
    }
    try {
      const where: any = {
        tenantId,
        paymentStatus: 'SUCCEEDED',
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      const orders = await this.prisma.order.findMany({
        where,
        select: {
          totalAmount: true,
          createdAt: true,
        },
      });

      const totalSales = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

      // Group by date
      const byDateMap = new Map<string, { count: number; amount: number }>();
      orders.forEach((order: any) => {
        const dateKey = order.createdAt.toISOString().split('T')[0];
        const existing = byDateMap.get(dateKey) || { count: 0, amount: 0 };
        existing.count += 1;
        existing.amount += Number(order.totalAmount || 0);
        byDateMap.set(dateKey, existing);
      });

      const byDate = Array.from(byDateMap.entries())
        .map(([date, data]) => ({
          date,
          count: data.count,
          amount: Number(data.amount.toFixed(2)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

      return {
        totalSales: roundCurrency(totalSales),
        totalOrders,
        averageOrderValue: roundCurrency(averageOrderValue),
        byDate,
      };
    } catch (error: any) {
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return {
          totalSales: 0,
          totalOrders: 0,
          averageOrderValue: 0,
          byDate: [],
        };
      }
      throw error;
    }
  }

  async getCustomerBalancesReport(tenantId: string) {
    if (!tenantId) {
      return { wallets: [], totalBalance: 0 };
    }
    try {
      // 1. Get all customers for this tenant
      const users = await this.prisma.user.findMany({
        where: { 
          tenantId,
          role: 'CUSTOMER' 
        },
        include: {
          wallet: {
            include: {
              transactions: {
                where: { 
                  status: 'COMPLETED' 
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                  topUpRequest: {
                    select: {
                      processedByUserId: true,
                      processedBy: {
                        select: {
                          id: true,
                          name: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // 2. Extract transaction references to find admin users
      const adminUserIds = new Set<string>();
      users.forEach((u: any) => {
        if (u.wallet?.transactions) {
          u.wallet.transactions.forEach((t: any) => {
            if (t.reference) {
              const match = t.reference.match(/^(?:RECHARGE_BY_|CHARGE_BY_)(.+)$/);
              if (match) {
                adminUserIds.add(match[1]);
              }
            }
          });
        }
      });

      // 3. Batch fetch admin users
      let adminUsersMap = new Map<string, { id: string; name: string; email: string }>();
      if (adminUserIds.size > 0) {
        const adminUsers = await this.prisma.user.findMany({
          where: { id: { in: Array.from(adminUserIds) } },
          select: { id: true, name: true, email: true },
        });
        adminUsers.forEach((u: any) => adminUsersMap.set(u.id, u));
      }

      // 4. Calculate total balance
      const totalBalance = users.reduce((sum: number, u: any) => sum + Number(u.wallet?.balance || 0), 0);

      // 5. Map to response format
      // Note: We map User to the "Wallet" structure expected by frontend
      const mappedWallets = users.map((u: any) => {
        const w = u.wallet;
        
        return {
          id: w?.id || `virtual-${u.id}`, // Fallback ID if no wallet
          userId: u.id,
          userName: u.name || u.email?.split('@')[0] || 'Unknown',
          userEmail: u.email || 'Unknown',
          userRole: u.role,
          balance: Number(w?.balance || 0),
          currency: w?.currency || 'SAR', // Default if no wallet
          lastRecharges: w?.transactions?.map((t: any) => {
             // Resolve performing user
             let performedBy: { id: string; name: string; email: string } | null = null;
 
             if (t.topUpRequest?.processedBy) {
               performedBy = t.topUpRequest.processedBy;
             } else if (t.reference) {
               const match = t.reference.match(/^(?:RECHARGE_BY_|CHARGE_BY_)(.+)$/);
               if (match) {
                 const adminUser = adminUsersMap.get(match[1]);
                 if (adminUser) {
                   performedBy = adminUser;
                 }
               }
             }
 
             return {
               id: t.id,
               amount: Number(t.amount),
               date: t.createdAt,
               ipAddress: t.ipAddress,
               userAgent: t.userAgent,
               description: t.description,
               type: t.type,
               performedBy: performedBy ? {
                 id: performedBy.id,
                 name: performedBy.name || performedBy.email?.split('@')[0] || 'Unknown',
                 email: performedBy.email,
               } : null,
             };
          }) || [], // Empty transactions if no wallet
        };
      });

      return {
        wallets: mappedWallets,
        totalBalance: Math.round(totalBalance * 100) / 100,
        currency: mappedWallets[0]?.currency || 'SAR',
      };
    } catch (error: any) {
      if (error?.code === 'P2003' || error?.message?.includes('Foreign key constraint')) {
        return { wallets: [], totalBalance: 0 };
      }
      throw error;
    }
  }
}

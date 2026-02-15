import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActionLoggingInterceptor implements NestInterceptor {
  private static tenantCache = new Map<string, { exists: boolean, timestamp: number }>();
  private readonly CACHE_TTL = 1000 * 60 * 5; // 5 minutes cache

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, query, params } = request;
    const user = (request as any).user;
    const ipAddress = request.ip || request.connection?.remoteAddress;
    const userAgent = request.headers['user-agent'];

    // Skip logging for certain endpoints
    const skipPaths = ['/api/health', '/api/admin/master', '/api/activity-log'];
    if (skipPaths.some(path => url.includes(path))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (response) => {
        try {
          // Log all successful actions
          const isSuccess = response && (
            (typeof response === 'object' && response.success === true) ||
            (typeof response === 'object' && !('statusCode' in response) && !('error' in response)) ||
            (typeof response === 'object' && 'statusCode' in response && response.statusCode >= 200 && response.statusCode < 300)
          );

          // Get tenant ID from user, request context, or header
          const tenantId = user?.tenantId || (request as any).tenantId || (request.headers['x-tenant-id'] as string);
          
          if (isSuccess && this.prisma.activityLog && tenantId && tenantId !== 'system') {
            try {
              // OPTIMIZATION: Cache tenant existence check to reduce DB load
              let tenantExists = false;
              const cached = ActionLoggingInterceptor.tenantCache.get(tenantId);
              const now = Date.now();
              
              if (cached && (now - cached.timestamp < this.CACHE_TTL)) {
                tenantExists = cached.exists;
              } else {
                const tenant = await this.prisma.tenant.findUnique({
                  where: { id: tenantId },
                  select: { id: true },
                });
                tenantExists = !!tenant;
                ActionLoggingInterceptor.tenantCache.set(tenantId, { exists: tenantExists, timestamp: now });
              }

              if (!tenantExists) return;

              // Log all successful actions
              await this.prisma.activityLog.create({
                data: {
                  tenantId,
                  actorId: user?.id || user?.sub || 'anonymous',
                  action: this.getFriendlyActionName(method, url),
                  targetId: params?.id || query?.id || body?.id || null,
                  details: {
                    method,
                    url,
                    originalAction: `${method} ${url.split('?')[0]}`,
                    body: this.sanitizeBody(body),
                    query,
                    params,
                    ipAddress,
                    userAgent,
                    resourceType: this.getResourceType(url),
                    userEmail: user?.email,
                    userName: user?.name,
                  },
                },
              });

            } catch (logError: any) {
              // If logging fails (e.g., foreign key constraint), silently skip
              // Don't break the request flow
              if (logError?.code !== 'P2003') { // P2003 is foreign key constraint error
                // Only log non-foreign-key errors for debugging
                console.warn('Activity log creation failed:', logError?.message);
              }
            }
          }
        } catch (error) {
          // Silent fail - don't break request if logging fails
        }
      }),
    );
  }

  private getFriendlyActionName(method: string, url: string): string {
    const path = url.split('?')[0].toLowerCase();
    
    // Mapping for common dashboard endpoints
    if (path.includes('/api/reports/payments')) return 'عرض تقارير المدفوعات';
    if (path.includes('/api/reports')) return 'عرض التقارير العام';
    if (path.includes('/api/orders')) return method === 'GET' ? 'عرض الطلبات' : 'تحديث طلب';
    if (path.includes('/api/suppliers')) return 'عرض قائمة الموردين';
    if (path.includes('/api/categories')) return 'عرض التصنيفات';
    if (path.includes('/api/brands')) return 'عرض العلامات التجارية';
    if (path.includes('/api/products')) return method === 'GET' ? 'عرض المنتجات / المخزون' : 'تحديث منتج';
    if (path.includes('/api/customers')) return 'عرض بيانات العملاء';
    if (path.includes('/api/transactions')) return 'عرض السجل المالي';
    if (path.includes('/api/wallet')) return 'إدارة المحفظة والرصيد';
    if (path.includes('/api/settings')) return 'تحديث إعدادات المتجر';
    if (path.includes('/api/auth/login')) return 'تسجيل الدخول';
    if (path.includes('/api/auth/logout')) return 'تسجيل الخروج';
    
    // Fallback if no specific mapping
    const resource = this.getResourceType(url).toLowerCase();
    const actionMap: Record<string, string> = {
      'get': 'عرض',
      'post': 'إضافة',
      'put': 'تحديث',
      'patch': 'تحديث',
      'delete': 'حذف',
    };

    const resourceMap: Record<string, string> = {
      'product': 'منتجات',
      'order': 'طلبات',
      'category': 'تصنيفات',
      'cart': 'سلة التسوق',
      'checkout': 'إتمام الطلب',
      'page': 'صفحات',
      'theme': 'القوالب',
      'settings': 'الإعدادات',
      'domain': 'النطاقات',
      'template': 'القوالب',
      'collection': 'المجموعات',
      'coupon': 'القسائم',
      'shipping': 'الشحن',
      'tax': 'الضرائب',
      'customer': 'العملاء',
      'dashboard': 'لوحة التحكم',
      'analytics': 'التحليلات',
      'report': 'التقارير',
      'transaction': 'العمليات',
      'payment': 'المدفوعات',
      'system': 'النظام'
    };

    const translatedAction = actionMap[method.toLowerCase()] || method;
    const translatedResource = resourceMap[resource] || resource;

    return `${translatedAction} ${translatedResource}`;
  }

  private getResourceType(url: string): string {
    if (url.includes('/products')) return 'PRODUCT';
    if (url.includes('/orders')) return 'ORDER';
    if (url.includes('/categories')) return 'CATEGORY';
    if (url.includes('/cart')) return 'CART';
    if (url.includes('/checkout')) return 'CHECKOUT';
    if (url.includes('/pages')) return 'PAGE';
    if (url.includes('/theme')) return 'THEME';
    if (url.includes('/settings')) return 'SETTINGS';
    if (url.includes('/site-config')) return 'SETTINGS';
    if (url.includes('/domain')) return 'DOMAIN';
    if (url.includes('/templates')) return 'TEMPLATE';
    if (url.includes('/collections')) return 'COLLECTION';
    if (url.includes('/coupons')) return 'COUPON';
    if (url.includes('/shipping')) return 'SHIPPING';
    if (url.includes('/tax')) return 'TAX';
    if (url.includes('/customers')) return 'CUSTOMER';
    if (url.includes('/dashboard')) return 'DASHBOARD';
    if (url.includes('/analytics')) return 'ANALYTICS';
    if (url.includes('/reports')) return 'REPORT';
    if (url.includes('/transactions')) return 'TRANSACTION';
    if (url.includes('/payment')) return 'PAYMENT';
    return 'SYSTEM';
  }

  private sanitizeBody(body: any): any {
    if (!body) return null;
    const sanitized = { ...body };
    // SECURITY FIX: Remove all sensitive fields
    if (sanitized.password) sanitized.password = '[REDACTED]';
    if (sanitized.token) sanitized.token = '[REDACTED]';
    if (sanitized.refreshToken) sanitized.refreshToken = '[REDACTED]';
    if (sanitized.accessToken) sanitized.accessToken = '[REDACTED]';
    if (sanitized.secret) sanitized.secret = '[REDACTED]';
    if (sanitized.apiKey) sanitized.apiKey = '[REDACTED]';
    if (sanitized.adminApiKey) sanitized.adminApiKey = '[REDACTED]';
    if (sanitized['x-admin-api-key']) sanitized['x-admin-api-key'] = '[REDACTED]';
    if (sanitized['x-api-key']) sanitized['x-api-key'] = '[REDACTED]';
    return sanitized;
  }
}


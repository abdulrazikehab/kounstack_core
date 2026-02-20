import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private prisma: PrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = typeof exceptionResponse === 'string' 
        ? exceptionResponse 
        : exceptionResponse;
    } else if (exception instanceof Error) {
      message = exception.message;
      stack = exception.stack;
    }

    // Save error to database
    try {
      const user = (request as any).user;
      const allowedRoles = new Set(['SUPER_ADMIN', 'SHOP_OWNER', 'STAFF', 'CUSTOMER']);
      const resolvedUserRole =
        typeof user?.role === 'string' && allowedRoles.has(user.role)
          ? user.role
          : 'STAFF';
      // Get tenantId and validate it exists (or set to undefined to avoid FK constraint violation)
      let tenantId: string | undefined = user?.tenantId || request.headers['x-tenant-id'] as string || undefined;
      
      // Validate tenantId exists if provided (to avoid FK constraint violation)
      if (tenantId) {
        try {
          const tenantExists = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
          });
          if (!tenantExists) {
            // Tenant doesn't exist, set to undefined to avoid FK constraint violation
            tenantId = undefined;
          }
        } catch (validationError) {
          // If validation fails, set to undefined to avoid FK constraint violation
          tenantId = undefined;
        }
      }
      
      // AuditLog.userId is required in current schema.
      const userId = user?.id || user?.userId || 'system';
      
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ERROR',
          resource: 'SYSTEM',
          resourceId: status.toString(),
          ipAddress: request.ip || request.connection?.remoteAddress || null,
          userAgent: request.headers['user-agent'] || null,
          changes: {
            severity: status >= 500 ? 'CRITICAL' : status >= 400 ? 'HIGH' : 'MEDIUM',
            message: typeof message === 'string' ? message : JSON.stringify(message),
            stack,
            method: request.method,
            path: (request as any).originalUrl || request.url || request.path,
            statusCode: status,
            tenantId: tenantId || null,
          },
          userRole: resolvedUserRole,
        },
      });
    } catch (error) {
      // Silent fail - don't break error response if logging fails
      this.logger.warn('Failed to save error to audit log:', error);
    }

    // Get the actual request path (use originalUrl if available, otherwise url)
    const requestPath = (request as any).originalUrl || request.url || request.path;

    // LOG THE ACTUAL ERROR BEFORE SANITIZATION (for debugging)
    this.logger.error(`❌ Exception caught:`, {
      status,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      stack,
      method: request.method,
      path: requestPath,
      url: request.url,
      headers: {
        'x-tenant-domain': request.headers['x-tenant-domain'],
        'x-tenant-id': request.headers['x-tenant-id'],
        'x-subdomain': request.headers['x-subdomain'],
        host: request.headers.host,
      },
      body: request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' 
        ? (request.body ? JSON.stringify(request.body).substring(0, 500) : 'no body')
        : undefined,
    });

    // SECURITY FIX: Sanitize error messages to prevent information leakage
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = !isProduction;
    let safeMessage: string | object = message;

    // Preserve messages from HttpExceptions (BadRequestException, NotFoundException, etc.)
    // These are already user-friendly and should be shown to users
    // In development, also preserve 500-level HttpException messages for debugging
    const isHttpException = exception instanceof HttpException;
    const shouldPreserveMessage = isHttpException && (status < 500 || isDevelopment);

    if (!shouldPreserveMessage && (isProduction || status >= 500)) {
      // Never expose stack traces or internal paths for 500+ errors
      if (typeof message === 'string') {
        // Remove stack traces, file paths, and technical details
        safeMessage = message
          .replace(/at\s+.*/g, '')
          .replace(/file:\/\/.*/g, '')
          .replace(/Error:\s*/gi, '')
          .replace(/\[.*?\]/g, '')
          .trim() || 'An error occurred';
      } else if (typeof message === 'object' && message !== null) {
        // Sanitize object messages
        const sanitized: any = {};
        for (const [key, value] of Object.entries(message)) {
          if (key !== 'stack' && key !== 'stackTrace' && key !== 'path' && key !== 'trace') {
            sanitized[key] = typeof value === 'string' 
              ? value.replace(/at\s+.*/g, '').replace(/file:\/\/.*/g, '')
              : value;
          }
        }
        safeMessage = sanitized;
      }
      
      // Generic messages for 500 errors (only for non-HttpExceptions or in production)
      // In development, preserve the sanitized message for debugging
      if (status >= 500 && isProduction) {
        safeMessage = 'The service is temporarily unavailable. Please try again later.';
      } else if (status >= 500 && isDevelopment) {
        // In development, include the sanitized error message for debugging
        // but still use generic message as fallback if sanitization removed everything
        if (typeof safeMessage === 'string' && safeMessage.trim().length === 0) {
          safeMessage = 'The service is temporarily unavailable. Please try again later.';
        }
      }
    }

    // Send standardized error response
    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : { path: requestPath }), // Hide path in production
      message: safeMessage,
    });
  }
}

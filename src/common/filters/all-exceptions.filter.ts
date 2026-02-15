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

    // Save error to database using activityLog
    try {
      const user = (request as any).user;
      // Get tenant ID from user, request context, or header
      const tenantId = user?.tenantId || (request as any).tenantId || request.headers['x-tenant-id'] as string;
      
      // Only log if we have a valid tenant ID (foreign key constraint requires existing tenant)
      if (this.prisma.activityLog && tenantId && tenantId !== 'system') {
        // Verify tenant exists before creating activity log to avoid foreign key constraint violation
        const tenantExists = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true },
        });

        if (tenantExists) {
          await this.prisma.activityLog.create({
            data: {
              tenantId,
              actorId: user?.id || user?.sub || 'anonymous',
              action: 'ERROR',
              targetId: status.toString(),
              details: {
                severity: status >= 500 ? 'CRITICAL' : status >= 400 ? 'HIGH' : 'MEDIUM',
                message: typeof message === 'string' ? message : JSON.stringify(message),
                stack,
                method: request.method,
                path: request.url,
                statusCode: status,
                ipAddress: request.ip || request.connection?.remoteAddress,
                userAgent: request.headers['user-agent'],
                resourceType: 'SYSTEM',
                userEmail: user?.email,
                userName: user?.name,
              },
            },
          });
        }
      }
    } catch (error) {
      // Silent fail - don't break error response if logging fails
      this.logger.debug(`Failed to log activity: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // SECURITY FIX: Sanitize error messages in production to prevent information leakage
    const isProduction = process.env.NODE_ENV === 'production';
    let safeMessage: string | object = message;
    
    // In development, show more details for debugging
    if (!isProduction && status >= 500) {
      // Log full error details for debugging
      this.logger.error(`[DEV] Full error details:`, {
        message,
        stack,
        status,
        path: request.url,
        method: request.method,
      });
      
      // In development, show the actual error message (but still sanitize stack traces)
      if (typeof message === 'string') {
        safeMessage = message.split('\n')[0]; // Show first line only
      } else if (typeof message === 'object' && message !== null && 'message' in message) {
        safeMessage = (message as any).message || message;
      }
    } else if (isProduction || status >= 500) {
      // Never expose stack traces or internal paths in production
      if (typeof message === 'string') {
        // Remove stack traces, file paths, and technical details
        safeMessage = message
          .replace(/at\s+.*/g, '')
          .replace(/file:\/\/.*/g, '')
          .replace(/Error:\s*/gi, '')
          .replace(/\[.*?\]/g, '')
          .replace(/\/.*\//g, '') // Remove file paths
          .replace(/:\d+:\d+/g, '') // Remove line numbers
          .trim() || 'An error occurred';
      } else if (typeof message === 'object' && message !== null) {
        // Sanitize object messages
        const sanitized: any = {};
        for (const [key, value] of Object.entries(message)) {
          // Never expose stack traces, paths, or internal details
          if (key !== 'stack' && key !== 'stackTrace' && key !== 'path' && key !== 'code' && key !== 'errno') {
            sanitized[key] = typeof value === 'string' 
              ? value.replace(/at\s+.*/g, '').replace(/file:\/\/.*/g, '').replace(/:\d+:\d+/g, '')
              : value;
          }
        }
        safeMessage = sanitized;
      }
      
      // Generic messages for 500 errors in production
      if (isProduction && status >= 500) {
        safeMessage = 'An internal server error occurred. Please try again later.';
      }
    }

    // Send standardized error response
    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : { path: request.url }), // Only expose path in development
      message: safeMessage,
    });
  }
}

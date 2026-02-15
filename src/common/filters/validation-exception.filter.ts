import { ExceptionFilter, Catch, ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ValidationExceptionFilter.name);

  private sanitizeBody(body: any): any {
    if (!body) return null;
    const sanitized = { ...body };
    // Remove sensitive fields
    if (sanitized.password) sanitized.password = '[REDACTED]';
    if (sanitized.token) sanitized.token = '[REDACTED]';
    if (sanitized.refreshToken) sanitized.refreshToken = '[REDACTED]';
    if (sanitized.accessToken) sanitized.accessToken = '[REDACTED]';
    if (sanitized.secret) sanitized.secret = '[REDACTED]';
    if (sanitized.apiKey) sanitized.apiKey = '[REDACTED]';
    if (sanitized.adminApiKey) sanitized.adminApiKey = '[REDACTED]';
    return sanitized;
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return null;
    const sanitized = { ...headers };
    // Remove sensitive headers
    if (sanitized.authorization) sanitized.authorization = '[REDACTED]';
    if (sanitized['x-admin-api-key']) sanitized['x-admin-api-key'] = '[REDACTED]';
    if (sanitized['x-api-key']) sanitized['x-api-key'] = '[REDACTED]';
    if (sanitized.cookie) sanitized.cookie = '[REDACTED]';
    return sanitized;
  }

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // SECURITY FIX: Sanitize sensitive data before logging
    this.logger.error(`Validation Error: ${JSON.stringify(exceptionResponse)}`);
    this.logger.error(`Request Body: ${JSON.stringify(this.sanitizeBody(request.body))}`);
    this.logger.error(`Request Headers: ${JSON.stringify(this.sanitizeHeaders(request.headers))}`);

    // Format the response properly
    let formattedResponse: any;
    
    if (typeof exceptionResponse === 'string') {
      formattedResponse = {
        message: exceptionResponse,
        error: 'Bad Request',
        statusCode: status,
      };
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      // Handle validation error arrays from class-validator
      if (Array.isArray((exceptionResponse as any).message)) {
        const messages = (exceptionResponse as any).message as string[];
        formattedResponse = {
          message: messages.join('. '),
          error: 'Bad Request',
          statusCode: status,
          errors: (exceptionResponse as any).message,
        };
      } else {
        // Use the response as-is, but ensure it has the right structure
        formattedResponse = {
          message: (exceptionResponse as any).message || 'Validation failed',
          error: (exceptionResponse as any).error || 'Bad Request',
          statusCode: status,
          ...(exceptionResponse as any),
        };
      }
    } else {
      formattedResponse = {
        message: 'Validation failed',
        error: 'Bad Request',
        statusCode: status,
      };
    }

    response.status(status).json(formattedResponse);
  }
}

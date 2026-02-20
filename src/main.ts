import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';

// Load environment variables FIRST with robust path checking
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'saa-ah_auth', '.env'),
  path.resolve(__dirname, '..', '.env'), 
];

let envFound = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    envFound = true;
    break;
  }
}

if (!envFound && !process.env.JWT_SECRET) {
  console.warn('⚠️  Warning: .env file not found and JWT_SECRET is missing. Check your working directory.');
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    const app = await NestFactory.create(AppModule, {
      bodyParser: false, // Disable default to configure our own with proper limits
      rawBody: false,
    });
    
    // Set global prefix to match Nginx proxy and frontend expectations
    app.setGlobalPrefix('api');
    
    // CRITICAL: Configure body parser limits for larger file uploads
    // Get the underlying Express instance and configure body size limits
    const expressApp = app.getHttpAdapter().getInstance();
    const express = require('express');
    
    // Add body parsers with increased limits (25MB to accommodate 20MB GIFs + overhead)
    // Note: multipart/form-data is handled by Multer, not these parsers
    expressApp.use(express.json({ limit: '25mb' }));
    expressApp.use(express.urlencoded({ limit: '25mb', extended: true }));
    
    // CRITICAL: Enable CORS FIRST before any other middleware to prevent duplicate headers
    // Enable CORS with proper origin handling to prevent duplicate headers

    // SECURITY FIX: CORS restricted to allowed origins only
    // Define allowed origins FIRST before using them in middleware
    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : [];
    const allowedOriginsList = [
      ...corsOrigins,
      'http://localhost:3000',
      'http://localhost:4173',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:4173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:8080',
      'https://kounworld.com',
      'https://saeaa.net',
      'https://www.kounworld.com',
      'https://www.saeaa.net',
      'https://app.kounworld.com',
      'https://app.saeaa.net',
      'https://kawn.com',
      'https://kawn.net',
      'https://www.kawn.com',
      'https://www.kawn.net',
      'https://app.kawn.com',
      'https://app.kawn.net',
      'http://192.168.1.32:4173',
    ].filter(Boolean);

    // CRITICAL: Handle OPTIONS preflight requests FIRST before CORS middleware
    // This ensures preflight requests get proper CORS headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') {
        // Set CORS headers for preflight
        const origin = req.headers.origin;
        // SECURITY FIX: Never use wildcard (*) for credentialed requests.
        // Only echo back a specific, validated origin.
        if (origin) {
          // Validate origin
          if (
            allowedOriginsList.includes(origin) ||
            /^https:\/\/([\w-]+\.)?(saeaa\.com|saeaa\.net|kawn\.com|kawn\.net)$/.test(origin) ||
            process.env.NODE_ENV === 'development'
          ) {
            res.setHeader('Access-Control-Allow-Origin', origin);
          }
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', [
          'Content-Type',
          'Authorization',
          'X-Requested-With',
          'Accept',
          'Origin',
          'X-Tenant-Id',
          'X-Tenant-Domain',
          'x-tenant-id',
          'x-tenant-domain',
          'X-Subdomain',
          'x-subdomain',
          'X-Session-ID',
          'x-session-id',
          'X-Admin-API-Key',
          'x-admin-api-key',
          'X-API-Key',
          'X-ApiKey',
          'x-api-key',
          'x-apikey'
        ].join(', '));
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
        return res.status(204).end(); // Respond to preflight immediately
      }
      next();
    });

    app.use(cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
        // Allow requests with no origin (mobile apps, Postman, curl)
        if (!origin) {
          return callback(null, true);
        }

        // Check exact match
        if (allowedOriginsList.includes(origin)) {
          return callback(null, origin);
        }

        // Allow subdomains of kawn.com and kawn.net and kounworld.com and saeaa.net
        const isAllowedSubdomain = /^https:\/\/([\w-]+\.)?(saeaa\.com|saeaa\.net|kawn\.com|kawn\.net)$/.test(origin);
        if (isAllowedSubdomain) {
          return callback(null, origin);
        }

        // Allow localhost subdomains (development)
        if (/^http:\/\/[\w-]+\.localhost(:\d+)?$/.test(origin)) {
          return callback(null, origin);
        }

        // Allow nip.io domains (development)
        if (origin.includes('.nip.io')) {
          return callback(null, origin);
        }

        // Reject unknown origins
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Tenant-Id',
        'X-Tenant-Domain',
        'x-tenant-id',
        'x-tenant-domain',
        'X-Subdomain',
        'x-subdomain',
        'X-Session-ID',
        'x-session-id',
        'X-Admin-API-Key',
        'x-admin-api-key',
        'X-API-Key',
        'X-ApiKey',
        'x-api-key',
        'x-apikey'
      ],
      exposedHeaders: [
        'Content-Type',
        'Authorization'
      ],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    }));

    // CRITICAL: Remove duplicate CORS headers before response is sent
    // This prevents duplicates from proxy/nginx/vercel
    app.use((req: Request, res: Response, next: NextFunction) => {
      const originalEnd = res.end.bind(res);
      res.end = function(chunk?: any, encoding?: any, cb?: any) {
        // Remove duplicate Access-Control-Allow-Origin headers
        const headers = res.getHeaders();
        const originHeader = headers['access-control-allow-origin'] || headers['Access-Control-Allow-Origin'];
        if (originHeader && Array.isArray(originHeader)) {
          // Multiple values found, keep only the first one
          res.removeHeader('Access-Control-Allow-Origin');
          res.removeHeader('access-control-allow-origin');
          res.setHeader('Access-Control-Allow-Origin', originHeader[0]);
        } else if (originHeader && typeof originHeader === 'string' && originHeader.includes(',')) {
          // Single string with comma-separated values, keep only first
          const firstValue = originHeader.split(',')[0].trim();
          res.removeHeader('Access-Control-Allow-Origin');
          res.removeHeader('access-control-allow-origin');
          res.setHeader('Access-Control-Allow-Origin', firstValue);
        }
        return originalEnd(chunk, encoding, cb);
      };
      next();
    });
    
    // Enable cookie parser AFTER CORS
    app.use(cookieParser());

    // SECURITY FIX: CSRF Protection for state-changing operations
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }
      
      // In production, enforce Origin/Referer checks
      if (process.env.NODE_ENV === 'production') {
        const origin = req.headers.origin as string;
        const referer = req.headers.referer as string;
        const requestedWith = req.headers['x-requested-with'];
        
        // 1. Check for custom header which browsers don't allow cross-origin without CORS
        // This is a standard way to bypass CSRF for API requests
        if (requestedWith) {
          return next();
        }

        const source = origin || referer;
        
        if (source) {
          const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || [];
          
          // Enhanced regex: Allow paths, ports, and subdomains
          const kawnDomainRegex = /^https?:\/\/([\w-]+\.)?(saeaa\.com|saeaa\.net|koun\.com|koun\.net|kawn\.com|kawn\.net)([:/].*)?$/;
          
          const isAllowed = allowedOrigins.some(allowed => source.startsWith(allowed)) || 
                           kawnDomainRegex.test(source);
                           
          if (!isAllowed) {
            logger.warn(`CSRF: Blocked ${req.method} request to ${req.path} from unauthorized source: ${source}`);
            return res.status(403).json({ 
              message: 'Forbidden: Invalid request source'
            });
          }
        } else {
          // Block requests with no source in production if they look like browser requests
          if (req.headers['user-agent']?.includes('Mozilla') && !requestedWith) {
             logger.warn(`CSRF: Blocked ${req.method} request to ${req.path} with missing Origin/Referer`);
             return res.status(403).json({ message: 'Forbidden: Request source missing' });
          }
        }
      }
      
      next();
    });
    
    // SECURITY FIX: Verify required secrets (no fallbacks)
    if (!process.env.JWT_SECRET) {
      logger.error('❌ JWT_SECRET is not configured in auth service environment variables');
      logger.error('❌ Application cannot start without JWT_SECRET');
      process.exit(1);
    }

    if (process.env.JWT_SECRET === 'fallback-secret' || process.env.JWT_SECRET.length < 32) {
      logger.error('❌ JWT_SECRET is using insecure default or too short');
      logger.error('❌ JWT_SECRET must be at least 32 characters');
      process.exit(1);
    }

    // SECURITY FIX: Add security headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
      res.removeHeader('X-Powered-By');
      
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      }
      
      next();
    });
    
    // SECURITY FIX: Global error handler to prevent information disclosure
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logger.error('Error occurred:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method,
      });

      // Ensure CORS headers are present even for errors
      const origin = req.headers.origin;
      if (origin) {
         // Re-check against allowed list to be safe, or just echo back in dev
        if (allowedOriginsList.includes(origin) || process.env.NODE_ENV === 'development' || /^https:\/\/([\w-]+\.)?(saeaa\.com|saeaa\.net|kawn\.com|kawn\.net)$/.test(origin)) {
           res.setHeader('Access-Control-Allow-Origin', origin);
           res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
      }
      
      // Don't expose error details in production
      if (process.env.NODE_ENV === 'production') {
        res.status(500).json({
          statusCode: 500,
          message: 'Internal server error',
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          statusCode: 500,
          message: err.message,
          stack: err.stack,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // SECURITY FIX: Enforce HTTPS in production
    if (process.env.NODE_ENV === 'production') {
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.header('x-forwarded-proto') !== 'https' && !req.header('host')?.includes('localhost')) {
          return res.redirect(`https://${req.header('host')}${req.url}`);
        }
        next();
      });
    }
    
    // Enable global validation
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

    // Exception filter is now registered in app.module.ts via APP_FILTER
    
    const port = process.env.CORE_PORT || 3002;
    await app.listen(port,'0.0.0.0');
    logger.log(`✅ Core API service running on port ${port}`);
  } catch (error) {
    logger.error('Failed to start auth service:', error);
    process.exit(1);
  }
}
bootstrap();
 

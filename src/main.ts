// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as dotenv from 'dotenv';
import * as path from 'path';
import helmet from 'helmet';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { securityConfig, isVerifiedCustomDomain } from './config/security.config';
import { json, urlencoded, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as express from 'express';
import * as fs from 'fs';

// Load environment variables first with robust path checking
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'saa-ah_core', '.env'),
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
  console.warn('⚠️  Warning: .env file not found. Check your working directory.');
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    
    // CRITICAL: Enable CORS FIRST before any other middleware to prevent duplicate headers
    // Enhanced CORS configuration for frontend and subdomains

    // CRITICAL: Handle OPTIONS preflight requests FIRST before CORS middleware
    // This ensures preflight requests get proper CORS headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') {
        // Set CORS headers for preflight
        const origin = req.headers.origin;
        if (origin) {
          // Validate origin using security config
          securityConfig.cors.origin(origin, (err, allowed) => {
            if (!err && allowed) {
              res.setHeader('Access-Control-Allow-Origin', allowed as string);
            }
          });
        } else if (process.env.NODE_ENV === 'development') {
          // SECURITY FIX: Only allow * in development
          res.setHeader('Access-Control-Allow-Origin', '*');
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

    // SECURITY FIX: CORS restricted to allowed origins only
    app.use(cors({
      origin: securityConfig.cors.origin,
      credentials: securityConfig.cors.credentials,
      methods: securityConfig.cors.methods.split(','),
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
      preflightContinue: securityConfig.cors.preflightContinue,
      optionsSuccessStatus: securityConfig.cors.optionsSuccessStatus,
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
    
    // SECURITY FIX: Hardened CSRF Protection for state-changing operations
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      // Skip CSRF for safe methods
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }
      
      const origin = req.headers.origin as string;
      const referer = req.headers.referer as string;
      const requestedWith = req.headers['x-requested-with'];
      
      // In production, we require either a custom header OR a valid origin
      if (process.env.NODE_ENV === 'production') {
        // 1. Check for custom header which browsers don't allow cross-origin without CORS
        if (requestedWith) {
          return next();
        }

        // 2. Validate Origin/Referer
        const source = origin || referer;
        
        if (source) {
          const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || [];
          
          // Enhanced regex: Allow paths, ports, and subdomains for platform domains
          const platformDomain = process.env.PLATFORM_DOMAIN || 'saeaa.com';
          const secondaryDomain = process.env.PLATFORM_SECONDARY_DOMAIN || 'saeaa.net';
          const escapedPlatform = platformDomain.replace(/\./g, '\\.');
          const escapedSecondary = secondaryDomain.replace(/\./g, '\\.');
          const kawnDomainRegex = new RegExp(`^https?:\\/\\/([\\w-]+\\.)?(koun\\.com|koun\\.net|kawn\\.com|kawn\\.net|${escapedPlatform}|${escapedSecondary})([:/].*)?$`);
          
          let isAllowed = allowedOrigins.some(allowed => source.startsWith(allowed)) || 
                           kawnDomainRegex.test(source);
          
          // Check if source is a verified custom domain (async with fallback)
          if (!isAllowed) {
            try {
              const sourceUrl = new URL(source);
              const hostname = sourceUrl.hostname.toLowerCase();
              const isCustom = await isVerifiedCustomDomain(hostname);
              if (isCustom) {
                isAllowed = true;
              }
            } catch {
              // Failed to check custom domain, fall through to block
            }
          }
                            
          if (!isAllowed) {
            logger.warn(`CSRF: Blocked ${req.method} request to ${req.path} from unauthorized source: ${source}`);
            return res.status(403).json({ 
              message: 'Forbidden: Invalid request source'
            });
          }
        } else {
          // If a state-changing request has cookies but no source header, it's likely a CSRF attempt
          if (req.headers.cookie) {
            logger.warn(`CSRF: State-changing request (${req.method}) to ${req.path} missing Origin/Referer from browser at ${req.ip}`);
            return res.status(403).json({ message: 'Forbidden: Request source missing' });
          }
        }
      }
      
      next();
    });
    
    // Increase body limit for image uploads and capture raw body for webhook verification
    app.use(json({ 
      limit: '10mb',
      verify: (req: any, res, buf) => {
        // OPTIMIZATION: Only capture rawBody for webhook verification to save memory on 'very big data'
        if (req.url && (req.url.includes('/webhook') || req.url.includes('/webhooks'))) {
          req.rawBody = buf;
        }
      }
    }));
    app.use(urlencoded({ 
      extended: true, 
      limit: '10mb',
      verify: (req: any, res, buf) => {
        if (req.url && (req.url.includes('/webhook') || req.url.includes('/webhooks'))) {
          req.rawBody = buf;
        }
      }
    }));

    // Serve static files from public directory (for app builder icons, APKs, etc.)
    app.useStaticAssets(path.join(process.cwd(), 'public'));
    
    // Serve uploads directory for digital card files and other dynamic content
    app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
      prefix: '/uploads',
    });

    // Set global prefix to handle /api/api/... routes from frontend
    // Frontend calls /api/api/categories, backend receives /api/api/categories
    // With global prefix 'api', route becomes /api/categories which matches controller
    app.setGlobalPrefix('api');
    
    // SECURITY FIX: Verify required secrets are loaded (no fallbacks)
    if (!process.env.JWT_SECRET) {
      logger.error('❌ JWT_SECRET is not configured in environment variables');
      logger.error('❌ Application cannot start without JWT_SECRET');
      process.exit(1);
    }
    
    if (process.env.JWT_SECRET === 'fallback-secret' || process.env.JWT_SECRET.length < 32) {
      logger.error('❌ JWT_SECRET is using insecure default or too short');
      logger.error('❌ JWT_SECRET must be at least 32 characters');
      process.exit(1);
    }

    if (!process.env.ORDER_TRACKING_SECRET || process.env.ORDER_TRACKING_SECRET === 'default-secret-change-in-production') {
      logger.error('❌ ORDER_TRACKING_SECRET is not configured or using default value');
      process.exit(1);
    }

    if (process.env.ORDER_TRACKING_SECRET.length < 32) {
      logger.error('❌ ORDER_TRACKING_SECRET must be at least 32 characters');
      process.exit(1);
    }

    if (!process.env.HYPERPAY_WEBHOOK_SECRET) {
      logger.error('❌ HYPERPAY_WEBHOOK_SECRET is not configured');
      process.exit(1);
    }

    // Security Hardening (AFTER CORS)
    app.use(helmet(securityConfig.helmet));
    
    // SECURITY FIX: Add additional security headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      // X-Content-Type-Options: Prevent MIME type sniffing
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // X-Frame-Options: Prevent clickjacking - ALLOW SAME ORIGIN for App Builder
      // Was DENY, which blocked iframes completely
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      // X-XSS-Protection: Enable XSS filter (legacy browsers)
      res.setHeader('X-XSS-Protection', '1; mode=block');
      // Referrer-Policy: Control referrer information
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      // Permissions-Policy: Restrict browser features
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
      // Remove X-Powered-By header (Helmet should handle this, but ensure it's removed)
      res.removeHeader('X-Powered-By');
      
      // HSTS: Force HTTPS in production
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
    
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors) => {
        const messages = errors.map((error) => {
          const constraints = error.constraints || {};
          return Object.values(constraints).join(', ');
        });
        return new BadRequestException({
          message: messages.join('. '),
          error: 'Bad Request',
          statusCode: 400,
          errors: errors.map((error) => ({
            property: error.property,
            value: error.value,
            constraints: error.constraints,
          })),
        });
      },
    }));
    
    // Add global filter to log validation errors
    const { ValidationExceptionFilter } = await import('./common/filters/validation-exception.filter');
    app.useGlobalFilters(new ValidationExceptionFilter());

    const port = process.env.CORE_PORT || 3002;
    await app.listen(port,'0.0.0.0');
    logger.log(`✅ app-core listening on port ${port}`);
    logger.log('🚀 AI RECEIPT ANALYSIS UPDATE v2 LOADED - Ready for SAB, SNB, and Negative Amounts');
  } catch (error) {
    logger.error('Failed to start core service:', error);
    process.exit(1);
  }
}

bootstrap();
 

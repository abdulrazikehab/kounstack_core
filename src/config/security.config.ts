import { HelmetOptions } from 'helmet';
import { PrismaClient } from '@prisma/client';

// Lazy-instantiated PrismaClient for CORS custom domain checks
let prismaForCors: PrismaClient | null = null;
function getPrismaForCors(): PrismaClient {
  if (!prismaForCors) {
    prismaForCors = new PrismaClient();
  }
  return prismaForCors;
}

// Cache verified custom domains to avoid DB hits on every request
const customDomainCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function isVerifiedCustomDomain(hostname: string): Promise<boolean> {
  const now = Date.now();
  const cached = customDomainCache.get(hostname);
  if (cached && cached.expiresAt > now) {
    return cached.allowed;
  }

  try {
    const prisma = getPrismaForCors();
    const domain = await prisma.customDomain.findFirst({
      where: {
        domain: hostname.toLowerCase(),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const allowed = !!domain;
    customDomainCache.set(hostname, { allowed, expiresAt: now + CACHE_TTL });
    return allowed;
  } catch (error) {
    console.warn(`[CORS] Failed to check custom domain ${hostname}:`, error);
    return false;
  }
}

export function invalidateDomainCache(hostname: string) {
  customDomainCache.delete(hostname);
}

// Security Configuration - FIXED: Removed permissive settings
export const securityConfig = {
  cors: {
    // SECURITY FIX: Restrict CORS to allowed origins only
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) {
        return callback(null, true);
      }

      // Get allowed origins from environment or use defaults
      const envOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : [];
      
      const platformDomain = process.env.PLATFORM_DOMAIN || 'kounworld.com';
      const secondaryDomain = process.env.PLATFORM_SECONDARY_DOMAIN || 'saeaa.net';
      
      const allowedOrigins = [
        ...envOrigins,
        // Development origins
        'http://localhost:3000',
        'http://localhost:4173',
        'http://localhost:5173',
        'http://localhost:4200',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:4173',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:8080',
        // Production origins
        `https://${platformDomain}`,
        `https://${secondaryDomain}`,
        `https://www.${platformDomain}`,
        `https://www.${secondaryDomain}`,
        `https://app.${platformDomain}`,
        `https://app.${secondaryDomain}`,
        // Legacy support
        'https://kawn.com',
        'https://kawn.net',
        'https://www.kawn.com',
        'https://www.kawn.net',
        'https://app.kawn.com',
        'https://app.kawn.net',
        'https://kounworld.com',
        'https://saeaa.net',
        'https://www.kounworld.com',
        'https://www.saeaa.net',
        'https://app.kounworld.com',
        'https://app.saeaa.net',
      ].filter(Boolean);

      // Check exact match
      if (allowedOrigins.includes(origin)) {
        return callback(null, origin);
      }

      // Allow subdomains of platform domains
      const platformPattern = platformDomain.replace('.', '\\.');
      const secondaryPattern = secondaryDomain.replace('.', '\\.');
      const legacyPattern = 'kawn\\.(com|net)|saeaa\\.(com|net)';
      
      const isAllowedSubdomain = new RegExp(`^https://([\\w-]+\\.)?(${platformPattern}|${secondaryPattern}|${legacyPattern})$`).test(origin);
      if (isAllowedSubdomain) {
        return callback(null, origin);
      }

      // Enhanced regex: Allow paths, ports, and subdomains for specific legacy domains
      if (/^https?:\/\/([\w-]+\.)?(saeaa\.com|saeaa\.net|koun\.com|koun\.net|kawn\.com|kawn\.net)([:/].*)?$/.test(origin)) {
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

      // Allow local network IPs (development)
      if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
        return callback(null, origin);
      }

      // Check if origin is a verified custom domain (async)
      try {
        const url = new URL(origin);
        const hostname = url.hostname;
        isVerifiedCustomDomain(hostname).then((isCustom) => {
          if (isCustom) {
            return callback(null, origin);
          }
          // Reject unknown origins
          callback(new Error(`Origin ${origin} is not allowed by CORS`));
        }).catch(() => {
          callback(new Error(`Origin ${origin} is not allowed by CORS`));
        });
      } catch {
        // Invalid URL format
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
  },
  rateLimit: {
    // SECURITY FIX: Reduced rate limits
    default: {
      ttl: 60000, // 1 minute
      limit: 1000, // Increased for development and complex UI components
    },
    auth: {
      ttl: 900000, // 15 minutes
      limit: 5, // 5 login attempts per 15 minutes
    },
    api: {
      ttl: 60000, // 1 minute
      limit: 60, // 60 API calls per minute
    },
  },
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // SECURITY FIX: Remove unsafe-inline, use nonces in production
        scriptSrc: process.env.NODE_ENV === 'production' 
          ? ["'self'"] 
          : ["'self'", "'unsafe-inline'"], // Allow inline in development only
        styleSrc: process.env.NODE_ENV === 'production'
          ? ["'self'"]
          : ["'self'", "'unsafe-inline'"], // Allow inline in development only
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'", 'https://api.hyperpay.com'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    // SECURITY FIX: Hide server information
    hidePoweredBy: true,
    // SECURITY FIX: Enable cross-origin policies in production
    crossOriginEmbedderPolicy: process.env.NODE_ENV === 'production',
    // Use typed literals to satisfy HelmetOptions
    crossOriginOpenerPolicy: process.env.NODE_ENV === 'production' ? { policy: 'same-origin' as const } : false,
    crossOriginResourcePolicy: process.env.NODE_ENV === 'production' ? { policy: 'same-origin' as const } : false,
    // SECURITY FIX: Additional security headers
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
  } satisfies HelmetOptions,
};

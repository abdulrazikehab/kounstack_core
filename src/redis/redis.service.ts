// apps/app-core/src/redis/redis.service.ts
import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly isAvailable: boolean;

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis | null) {
    this.isAvailable = redisClient !== null;
    if (!this.isAvailable) {
      this.logger.warn('Redis client is not available. All operations will be no-ops.');
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
      this.logger.log('Redis connection closed');
    }
  }

  // Basic operations
  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.isAvailable || !this.redisClient) return;
    
    const serializedValue = JSON.stringify(value);
    if (ttl) {
      await this.redisClient.setex(key, ttl, serializedValue);
    } else {
      await this.redisClient.set(key, serializedValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isAvailable || !this.redisClient) return null;
    
    try {
      const value = await this.redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error(`Error getting key ${key}:`, error);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable || !this.redisClient) return;
    await this.redisClient.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isAvailable || !this.redisClient) return false;
    const result = await this.redisClient.exists(key);
    return result === 1;
  }

  async expire(key: string, ttl: number): Promise<void> {
    if (!this.isAvailable || !this.redisClient) return;
    await this.redisClient.expire(key, ttl);
  }

  // Cart session methods
  async setCartSession(sessionId: string, cartData: any, ttl: number = 24 * 60 * 60): Promise<void> {
    await this.set(`cart:${sessionId}`, cartData, ttl);
  }

  async getCartSession(sessionId: string): Promise<any> {
    return this.get(`cart:${sessionId}`);
  }

  async deleteCartSession(sessionId: string): Promise<void> {
    await this.del(`cart:${sessionId}`);
  }

  // Rate limiting
  async checkRateLimit(key: string, maxAttempts: number, windowMs: number): Promise<{ allowed: boolean; remaining: number }> {
    if (!this.isAvailable || !this.redisClient) {
      return { allowed: true, remaining: maxAttempts };
    }
    
    const current = await this.redisClient.incr(key);
    
    if (current === 1) {
      await this.redisClient.pexpire(key, windowMs);
    }

    const remaining = Math.max(0, maxAttempts - current);

    return {
      allowed: current <= maxAttempts,
      remaining,
    };
  }

  // Cache methods
  async setCache(key: string, value: any, ttl: number = 3600): Promise<void> {
    await this.set(`cache:${key}`, value, ttl);
  }

  async getCache<T>(key: string): Promise<T | null> {
    return this.get(`cache:${key}`);
  }

  async clearCache(pattern: string = 'cache:*'): Promise<void> {
    if (!this.isAvailable || !this.redisClient) return;
    
    const keys = await this.redisClient.keys(pattern);
    if (keys.length > 0) {
      await this.redisClient.del(...keys);
    }
  }

  // Tenant-specific caching
  async setTenantCache(tenantId: string, key: string, value: any, ttl?: number): Promise<void> {
    await this.set(`tenant:${tenantId}:${key}`, value, ttl);
  }

  async getTenantCache<T>(tenantId: string, key: string): Promise<T | null> {
    return this.get(`tenant:${tenantId}:${key}`);
  }

  // Product caching
  async cacheProduct(tenantId: string, productId: string, productData: any, ttl: number = 3600): Promise<void> {
    await this.set(`product:${tenantId}:${productId}`, productData, ttl);
  }

  async getCachedProduct<T>(tenantId: string, productId: string): Promise<T | null> {
    return this.get(`product:${tenantId}:${productId}`);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable || !this.redisClient) return false;
    
    try {
      await this.redisClient.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }

  // Get Redis info
  async getInfo(): Promise<any> {
    if (!this.isAvailable || !this.redisClient) return null;
    return this.redisClient.info();
  }
}
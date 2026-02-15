import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';
import { ImageOptimizer } from '../utils/image-optimizer.util';

/**
 * Mobile Optimization Interceptor
 * 
 * Automatically optimizes API responses for mobile:
 * - Optimizes image URLs (thumbnails for lists, medium for details)
 * - Adds mobile-friendly cache headers
 * - Adds pagination metadata (hasMore flag)
 * - Converts Date objects to ISO strings for smaller payloads
 */
@Injectable()
export class MobileOptimizationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();
    const url = request.url;

    // Check if mobile optimization is requested (via query param or User-Agent)
    const isMobileRequest = 
      request.query?.mobile === 'true' || 
      request.query?.optimize === 'true' ||
      /Mobile|Android|iPhone|iPad/i.test(request.headers['user-agent'] || '');

    // Set mobile-optimized headers
    if (isMobileRequest) {
      // Different cache strategies based on endpoint
      if (url.includes('/products') || url.includes('/cart')) {
        response.setHeader('Cache-Control', 'private, max-age=30, must-revalidate');
      } else if (url.includes('/orders') || url.includes('/wallet')) {
        response.setHeader('Cache-Control', 'private, max-age=10, must-revalidate');
      } else {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }

      response.setHeader('Vary', 'Accept-Encoding');
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }

    return next.handle().pipe(
      map((data) => {
        if (!isMobileRequest || !data) return data;

        // Optimize response data
        return this.optimizeResponse(data, url);
      }),
    );
  }

  private optimizeResponse(data: any, url: string): any {
    // Determine image size based on endpoint
    const imageSize = url.includes('/products/') && !url.includes('?') 
      ? 'medium' // Detail view
      : 'thumb'; // List view

    // Optimize based on data structure
    if (Array.isArray(data)) {
      return data.map(item => this.optimizeItem(item, imageSize));
    }

    if (data?.data && Array.isArray(data.data)) {
      // Paginated response
      return {
        ...data,
        data: data.data.map((item: any) => this.optimizeItem(item, imageSize)),
        meta: {
          ...data.meta,
          hasMore: data.meta?.page < data.meta?.totalPages,
        },
      };
    }

    return this.optimizeItem(data, imageSize);
  }

  private optimizeItem(item: any, imageSize: 'thumb' | 'small' | 'medium' | 'large'): any {
    if (!item || typeof item !== 'object') return item;

    const optimized = { ...item };

    // Optimize image URLs
    if (optimized.images && Array.isArray(optimized.images)) {
      optimized.images = optimized.images.map((img: any) => {
        if (typeof img === 'string') {
          return ImageOptimizer.optimizeUrl(img, imageSize);
        }
        if (img?.url) {
          return {
            ...img,
            url: ImageOptimizer.optimizeUrl(img.url, imageSize),
            thumbnail: ImageOptimizer.getThumbnail(img.url),
          };
        }
        return img;
      });
    }

    // Optimize single image/thumbnail fields
    if (optimized.image) {
      optimized.image = ImageOptimizer.optimizeUrl(optimized.image, imageSize);
      optimized.thumbnail = ImageOptimizer.getThumbnail(optimized.image);
    }

    if (optimized.thumbnail) {
      optimized.thumbnail = ImageOptimizer.getThumbnail(optimized.thumbnail);
    }

    if (optimized.logo) {
      optimized.logo = ImageOptimizer.optimizeUrl(optimized.logo, 'small');
    }

    // Convert Date objects to ISO strings for smaller payloads
    if (optimized.createdAt instanceof Date) {
      optimized.createdAt = optimized.createdAt.toISOString();
    }
    if (optimized.updatedAt instanceof Date) {
      optimized.updatedAt = optimized.updatedAt.toISOString();
    }

    // Optimize nested objects
    if (optimized.product) {
      optimized.product = this.optimizeItem(optimized.product, imageSize);
    }

    if (optimized.items && Array.isArray(optimized.items)) {
      optimized.items = optimized.items.map((item: any) => this.optimizeItem(item, imageSize));
    }

    if (optimized.orderItems && Array.isArray(optimized.orderItems)) {
      optimized.orderItems = optimized.orderItems.map((item: any) => this.optimizeItem(item, imageSize));
    }

    if (optimized.cartItems && Array.isArray(optimized.cartItems)) {
      optimized.cartItems = optimized.cartItems.map((item: any) => this.optimizeItem(item, imageSize));
    }

    return optimized;
  }
}


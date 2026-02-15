/**
 * Image Optimization Utility
 * Automatically optimizes image URLs for mobile devices
 */

export class ImageOptimizer {
  /**
   * Optimize image URL for mobile (add thumbnail transformation if using Cloudinary)
   * @param url - Original image URL
   * @param size - Size variant: 'thumb' (200x200), 'small' (400x400), 'medium' (800x800), 'large' (1200x1200)
   * @returns Optimized image URL
   */
  static optimizeUrl(url?: string | null, size: 'thumb' | 'small' | 'medium' | 'large' = 'thumb'): string | undefined {
    if (!url) return undefined;

    // If using Cloudinary, add transformation parameters
    if (url.includes('cloudinary.com') && url.includes('/upload/')) {
      const sizes = {
        thumb: 'w_200,h_200,c_fill,q_auto,f_auto',
        small: 'w_400,h_400,c_fill,q_auto,f_auto',
        medium: 'w_800,h_800,c_fill,q_auto,f_auto',
        large: 'w_1200,h_1200,c_fill,q_auto,f_auto',
      };
      const transform = sizes[size];
      
      // Insert transformation before filename
      return url.replace('/upload/', `/upload/${transform}/`);
    }

    // Return original URL for other image hosts
    return url;
  }

  /**
   * Optimize multiple image URLs
   */
  static optimizeUrls(urls: (string | null | undefined)[], size: 'thumb' | 'small' | 'medium' | 'large' = 'thumb'): string[] {
    return urls
      .map(url => this.optimizeUrl(url, size))
      .filter((url): url is string => url !== undefined);
  }

  /**
   * Get thumbnail URL (200x200)
   */
  static getThumbnail(url?: string | null): string | undefined {
    return this.optimizeUrl(url, 'thumb');
  }

  /**
   * Get small image URL (400x400)
   */
  static getSmall(url?: string | null): string | undefined {
    return this.optimizeUrl(url, 'small');
  }

  /**
   * Get medium image URL (800x800)
   */
  static getMedium(url?: string | null): string | undefined {
    return this.optimizeUrl(url, 'medium');
  }

  /**
   * Get large image URL (1200x1200)
   */
  static getLarge(url?: string | null): string | undefined {
    return this.optimizeUrl(url, 'large');
  }
}


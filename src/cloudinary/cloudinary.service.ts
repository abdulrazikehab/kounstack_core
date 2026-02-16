// apps/app-core/src/cloudinary/cloudinary.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';

export interface CloudinaryUploadResponse {
  publicId: string;
  url: string;
  secureUrl: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private configService: ConfigService) {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'ecommerce'
  ): Promise<CloudinaryUploadResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error('Cloudinary upload error:', error);
            reject(new Error(`Upload failed: ${error.message}`));
          } else if (result) {
            resolve({
              publicId: result.public_id,
              url: result.url,
              secureUrl: result.secure_url,
              format: result.format,
              width: result.width,
              height: result.height,
              bytes: result.bytes,
            });
          } else {
            reject(new Error('Upload failed: No result returned'));
          }
        }
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadMultipleImages(
    files: Express.Multer.File[],
    folder: string = 'ecommerce'
  ): Promise<CloudinaryUploadResponse[]> {
    const uploadPromises = files.map(file => this.uploadImage(file, folder));
    return Promise.all(uploadPromises);
  }

  async deleteImage(publicId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) {
          this.logger.error('Cloudinary delete error:', error);
          reject(new Error(`Delete failed: ${error.message}`));
        } else if (result?.result === 'ok') {
          this.logger.log(`Image ${publicId} deleted successfully`);
          resolve();
        } else {
          reject(new Error('Delete failed: Unknown error'));
        }
      });
    });
  }

  generateOptimizedUrl(publicId: string, width: number = 800, quality: string = 'auto'): string {
    return cloudinary.url(publicId, {
      width,
      quality,
      fetch_format: 'auto',
      crop: 'limit',
    });
  }

  generateThumbnailUrl(publicId: string, width: number = 300, height: number = 300): string {
    return cloudinary.url(publicId, {
      width,
      height,
      crop: 'fill',
      quality: 'auto',
      fetch_format: 'auto',
    });
  }

  // Test connection to Cloudinary
  async testConnection(): Promise<boolean> {
    try {
      // Try to upload a small test image or check credentials
      const result = await cloudinary.api.ping();
      this.logger.log('Cloudinary connection test successful');
      return true;
    } catch (error) {
      this.logger.error('Cloudinary connection test failed:', error);
      return false;
    }
  }

  // ============================================
  // MEDIA API METHODS
  // ============================================

  /**
   * Get images from a single Cloudinary folder
   */
  async getImagesFromFolder(
    folder: string,
    options: {
      resourceType?: string;
      limit?: number;
      nextCursor?: string;
      sort?: 'asc' | 'desc';
      fields?: string[];
    } = {}
  ): Promise<{
    folder: string;
    count: number;
    totalCount: number;
    data: any[];
    nextCursor?: string;
  }> {
    try {
      const {
        resourceType = 'image',
        limit = 20,
        nextCursor,
        sort = 'desc',
      } = options;

      // Use resources API to list resources in folder
      const result: any = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix: folder,
        max_results: Math.min(limit, 100),
        next_cursor: nextCursor,
      });

      const images = result.resources || [];
      const totalCount = result.total_count || images.length;

      // Sort images by created_at
      images.sort((a: any, b: any) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sort === 'desc' ? dateB - dateA : dateA - dateB;
      });

      // Format response
      const formattedImages = images.map((img: any) => ({
        public_id: img.public_id,
        secure_url: img.secure_url,
        url: img.url,
        format: img.format,
        width: img.width,
        height: img.height,
        bytes: img.bytes,
        created_at: img.created_at,
        resource_type: img.resource_type,
        folder: img.folder,
      }));

      return {
        folder,
        count: formattedImages.length,
        totalCount,
        data: formattedImages,
        nextCursor: result.next_cursor,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching images from folder ${folder}:`, error);
      throw new Error(`Failed to fetch images: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Get images from multiple Cloudinary folders
   */
  async getImagesFromFolders(
    folders: string[],
    options: {
      resourceType?: string;
      limit?: number;
      nextCursors?: Record<string, string>;
      sort?: 'asc' | 'desc';
      fields?: string[];
    } = {}
  ): Promise<{
    folders: string[];
    count: number;
    totalCount: number;
    data: any[];
    nextCursors: Record<string, string | undefined>;
  }> {
    try {
      const {
        resourceType = 'image',
        limit = 20,
        nextCursors = {},
        sort = 'desc',
      } = options;

      // Fetch images from all folders in parallel
      const folderPromises = folders.map((folder) =>
        this.getImagesFromFolder(folder, {
          resourceType,
          limit: Math.ceil(limit / folders.length), // Distribute limit across folders
          nextCursor: nextCursors[folder],
          sort,
        })
      );

      const results = await Promise.all(folderPromises);

      // Merge all images
      let allImages: any[] = [];
      results.forEach((result) => {
        allImages = allImages.concat(result.data);
      });

      // Sort by created_at
      allImages.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sort === 'desc' ? dateB - dateA : dateA - dateB;
      });

      // Limit to requested amount
      allImages = allImages.slice(0, limit);

      // Build next cursors object
      const newNextCursors: Record<string, string | undefined> = {};
      results.forEach((result, index) => {
        newNextCursors[folders[index]] = result.nextCursor;
      });

      // Calculate total count
      const totalCount = results.reduce((sum, result) => sum + result.totalCount, 0);

      return {
        folders,
        count: allImages.length,
        totalCount,
        data: allImages,
        nextCursors: newNextCursors,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching images from folders ${folders.join(', ')}:`, error);
      throw new Error(`Failed to fetch images: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * List available folders/subfolders under a root folder
   */
  async listFolders(root?: string): Promise<string[]> {
    try {
      if (!root) {
        // Return all root folders
        const result = await cloudinary.api.root_folders();
        return result.folders?.map((f: any) => f.name) || [];
      }

      // Get subfolders under the root
      const subfoldersResult = await cloudinary.api.sub_folders(root);
      return subfoldersResult.folders?.map((f: any) => f.path) || [];
    } catch (error: any) {
      // If folder doesn't exist, return empty list instead of error
      if (error?.error?.http_code === 404 || error?.message?.includes('not found')) {
        this.logger.warn(`Folder ${root} not found, returning empty list`);
        return [];
      }
      this.logger.error(`Error listing folders${root ? ` under ${root}` : ''}:`, error);
      throw new Error(`Failed to list folders: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Rename a Cloudinary resource
   */
  async renameImage(oldPublicId: string, newPublicId: string): Promise<any> {
    try {
      this.logger.log(`Renaming Cloudinary image from ${oldPublicId} to ${newPublicId}`);
      return await cloudinary.uploader.rename(oldPublicId, newPublicId, {
        overwrite: true,
        invalidate: true,
      });
    } catch (error: any) {
      this.logger.error(`Error renaming Cloudinary image: ${error.message}`, error.stack);
      throw new Error(`Failed to rename image: ${error.message}`);
    }
  }

  /**
   * Extract public ID from a Cloudinary URL
   */
  extractPublicId(url: string): string | null {
    if (!url || !url.includes('cloudinary.com')) return null;
    
    try {
      // Standard Cloudinary URL structure: .../upload/v12345678/folder/public_id.jpg
      const parts = url.split('/');
      const uploadIndex = parts.indexOf('upload');
      if (uploadIndex === -1) return null;
      
      // The public ID is everything after the version (v12345678) or after 'upload/' if no version
      const afterUpload = parts.slice(uploadIndex + 1);
      
      // If the first part starts with 'v' and is followed by digits, it's a version number
      if (afterUpload[0] && afterUpload[0].match(/^v\d+$/)) {
        afterUpload.shift();
      }
      
      const publicIdWithExtension = afterUpload.join('/');
      // Remove file extension
      return publicIdWithExtension.replace(/\.[^/.]+$/, "");
    } catch (error) {
      this.logger.warn(`Failed to extract public ID from URL: ${url}`);
      return null;
    }
  }

  /**
   * Renames an image and returns the new secure URL
   */
  async renameAndGetNewSecureUrl(url: string, newName: string): Promise<string> {
    if (!url || !url.includes('cloudinary.com')) return url;
    
    const publicId = this.extractPublicId(url);
    if (!publicId) return url;

    // Determine folder
    const folderParts = publicId.split('/');
    folderParts.pop(); // remove filename
    const folder = folderParts.join('/');
    
    const newPublicId = folder ? `${folder}/${newName}` : newName;
    
    // If it's already named that way, or if renaming to the same name
    if (publicId === newPublicId) return url;

    try {
      const result = await this.renameImage(publicId, newPublicId);
      return result.secure_url;
    } catch (error) {
      this.logger.warn(`Renaming failed, returning original URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return url;
    }
  }
}
import {
  Controller,
  Get,
  Query,
  BadRequestException,
  BadGatewayException,
  Logger,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { UserRole } from '../types/user-role.enum';

@Controller('media')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /**
   * GET /api/media/access
   * Check if the current user has access to Cloudinary features
   */
  @Get('access')
  async checkAccess(@Request() req: any) {
    // Since this controller is guarded by TenantRequiredGuard, 
    // simply reaching here implies the user is authenticated and belongs to a tenant.
    // In a more complex setup, we could check specific permissions or quota.
    return { 
      hasAccess: true, 
      user: { 
        id: req.user.id, 
        email: req.user.email 
      } 
    };
  }

  /**
   * GET /api/media/images
   * Fetch images from Cloudinary folders for the active tenant
   */
  @Get('images')
  async getImages(
    @Request() req: any,
    @Query('folder') folder?: string,
    @Query('folders') folders?: string,
    @Query('resource_type') resourceType?: string,
    @Query('limit') limit?: string,
    @Query('next_cursor') nextCursor?: string,
    @Query('next_cursors') nextCursors?: string,
    @Query('sort') sort?: string,
    @Query('fields') fields?: string,
  ) {
    try {
      // Validate that either folder or folders is provided (but not both)
      if (folder === undefined && !folders) {
        throw new BadRequestException("Either 'folder' or 'folders' parameter is required.");
      }

      if (folder !== undefined && folders) {
        throw new BadRequestException("Cannot use both 'folder' and 'folders' parameters. Use one or the other.");
      }

      const tenantId = req.tenantId;
      const tenantPrefix = `tenants/${tenantId}/`;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;

      const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
      const parsedSort = (sort === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
      const parsedFields = fields ? fields.split(',').map((f) => f.trim()) : undefined;

      // Single folder
      if (folder !== undefined) {
        try {
          // SECURITY FIX: Enforce tenant isolation by prefixing the folder path
          // SUPER_ADMIN can bypass this if they provide a 'root/' prefix
          let rawPath: string;
          if (isSuperAdmin && folder.startsWith('root/')) {
            rawPath = folder.substring(5); // Remove 'root/' prefix to get real Cloudinary root path
          } else {
            rawPath = folder.startsWith('tenants/') ? folder : `${tenantPrefix}${folder}`;
          }
          
          // Basic traversal check
          if (rawPath.includes('..')) {
             throw new BadRequestException("Invalid folder path: Traversal detected");
          }

          const fullPath = rawPath;
          
          // Only enforce tenantPrefix if NOT a super admin OR if not using the root/ bypass
          if (!isSuperAdmin && !fullPath.startsWith(tenantPrefix)) {
            throw new BadRequestException("Access denied: You can only access media within your own tenant folder.");
          }

          const result = await this.cloudinaryService.getImagesFromFolder(fullPath, {
            resourceType: resourceType || 'image',
            limit: parsedLimit,
            nextCursor,
            sort: parsedSort,
            fields: parsedFields,
          });

          return {
            success: true,
            folder: result.folder,
            count: result.count,
            image_count: result.count,
            total_image_count: result.totalCount,
            data: result.data,
            ...(result.nextCursor && { next_cursor: result.nextCursor }),
          };
        } catch (error: any) {
          this.logger.error(`Error fetching images from folder ${folder}:`, error);
          throw new BadGatewayException(`Cloudinary API error: ${error.message || 'Unknown error'}`);
        }
      }

      // Multiple folders
      if (folders) {
        try {
          const folderList = folders.split(',').map((f) => f.trim()).filter(Boolean);
          
          if (folderList.length === 0) {
            throw new BadRequestException('Invalid folders parameter. Provide comma-separated folder paths.');
          }

          // SECURITY FIX: Enforce tenant isolation for all requested folders
          const securedFolderList = folderList.map(f => {
            const rawPath = f.startsWith('tenants/') ? f : `${tenantPrefix}${f}`;
            
            // Basic traversal check
            if (rawPath.includes('..')) {
               throw new BadRequestException(`Invalid folder path: Traversal detected in ${f}`);
            }
            
            if (!rawPath.startsWith(tenantPrefix)) {
              throw new BadRequestException(`Access denied to folder: ${f}`);
            }
            return rawPath;
          });

          // SECURITY FIX: Validate next_cursors JSON structure with schema validation
          let parsedNextCursors: Record<string, string> = {};
          if (nextCursors) {
            try {
              const decoded = decodeURIComponent(nextCursors);
              const parsed = JSON.parse(decoded);
              
              // SECURITY: Validate structure - must be a plain object with string values only
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                this.logger.warn('Invalid next_cursors: must be an object');
                throw new BadRequestException('Invalid next_cursors format: expected object with string values');
              }
              
              // SECURITY: Validate no prototype pollution attempts
              if (Object.prototype.hasOwnProperty.call(parsed, '__proto__') ||
                  Object.prototype.hasOwnProperty.call(parsed, 'constructor') ||
                  Object.prototype.hasOwnProperty.call(parsed, 'prototype')) {
                this.logger.error('❌ SECURITY: Prototype pollution attempt detected in next_cursors');
                throw new BadRequestException('Invalid next_cursors: contains forbidden properties');
              }
              
              // SECURITY: Validate all values are strings and keys are safe
              for (const [key, value] of Object.entries(parsed)) {
                if (typeof value !== 'string') {
                  this.logger.warn(`Invalid next_cursors value type for key "${key}": ${typeof value}`);
                  throw new BadRequestException(`Invalid next_cursors: all values must be strings`);
                }
                // Limit key length to prevent DoS
                if (key.length > 500 || value.length > 500) {
                  throw new BadRequestException('Invalid next_cursors: key or value too long');
                }
              }
              
              // Limit number of keys to prevent DoS
              if (Object.keys(parsed).length > 50) {
                throw new BadRequestException('Invalid next_cursors: too many entries (max 50)');
              }
              
              parsedNextCursors = parsed;
            } catch (parseError) {
              // If it's already a BadRequestException, re-throw it
              if (parseError instanceof BadRequestException) {
                throw parseError;
              }
              this.logger.warn('Failed to parse next_cursors, invalid JSON:', parseError);
              throw new BadRequestException('Invalid next_cursors: malformed JSON');
            }
          }

          const result = await this.cloudinaryService.getImagesFromFolders(securedFolderList, {
            resourceType: resourceType || 'image',
            limit: parsedLimit,
            nextCursors: parsedNextCursors,
            sort: parsedSort,
            fields: parsedFields,
          });

          return {
            success: true,
            folders: result.folders,
            count: result.count,
            image_count: result.count,
            total_image_count: result.totalCount,
            data: result.data,
            ...(Object.keys(result.nextCursors).length > 0 && {
              next_cursors: result.nextCursors,
            }),
          };
        } catch (error: any) {
          this.logger.error(`Error fetching images from folders ${folders}:`, error);
          throw new BadGatewayException(`Cloudinary API error: ${error.message || 'Unknown error'}`);
        }
      }
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) {
        throw error;
      }
      this.logger.error('Unexpected error in getImages:', error);
      throw new BadGatewayException(`Failed to fetch images: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * GET /api/media/folders
   * List available folders/subfolders
   * Defaults to "Asus" folder's subfolders if no root is provided
   */
  @Get('folders')
  async listFolders(@Request() req: any, @Query('root') root?: string) {
    try {
      const tenantId = req.tenantId;
      const tenantPrefix = `tenants/${tenantId}/`;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      
      // SECURITY FIX: Enforce tenant isolation for listed folders
      // SUPER_ADMIN can bypass this if they provide 'root' as the root
      let targetRoot: string;
      if (isSuperAdmin && root === 'root') {
        targetRoot = ''; // Real root of Cloudinary
      } else {
        targetRoot = root 
          ? (root.startsWith('tenants/') ? root : `${tenantPrefix}${root}`)
          : `tenants/${tenantId}`;
      }

      // Basic traversal check
      if (targetRoot.includes('..')) {
         throw new BadRequestException("Invalid folder path: Traversal detected");
      }
      
      if (!isSuperAdmin && targetRoot !== `tenants/${tenantId}` && !targetRoot.startsWith(tenantPrefix)) {
        throw new BadRequestException("Access denied: Invalid folder path.");
      }
      
      const folders = await this.cloudinaryService.listFolders(targetRoot);
      
      // If we are listing the actual root for a super admin, prefix the folder names 
      // with 'root/' so that subsequent getImages calls know to bypass tenant isolation.
      const processedFolders = (isSuperAdmin && targetRoot === '') 
        ? folders.map(f => `root/${f}`) 
        : folders;

      return {
        success: true,
        root: targetRoot,
        folders: processedFolders,
      };
    } catch (error: any) {
      this.logger.error(`Error listing folders${root ? ` under ${root}` : ' (default: Asus)'}:`, error);
      throw new BadGatewayException(`Cloudinary API error: ${error.message || 'Unknown error'}`);
    }
  }
}


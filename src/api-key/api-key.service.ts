import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Generate a secure API key
   * Format: bb_<random 32 bytes hex>_<timestamp>
   */
  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now().toString(36);
    return `bb_${randomBytes}_${timestamp}`;
  }

  /**
   * Extract prefix from API key for lookup
   * Format: bb_<hash>_<timestamp> -> bb_<hash>
   */
  private getApiKeyPrefix(apiKey: string): string {
    const parts = apiKey.split('_');
    if (parts.length >= 3) {
      return `${parts[0]}_${parts[1]}`;
    }
    return apiKey.substring(0, 20); // Fallback to first 20 chars
  }

  /**
   * Hash the API key for storage
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    return bcrypt.hash(apiKey, 12);
  }

  /**
   * Verify API key against hash
   */
  async verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
    return bcrypt.compare(apiKey, hash);
  }

  /**
   * Ensure system tenant exists for API keys
   */
  private async ensureSystemTenant(): Promise<string> {
    const SYSTEM_TENANT_ID = 'system-api-keys';
    const SYSTEM_SUBDOMAIN = 'system-api-keys';
    
    try {
      // First, try to find existing tenant (handle race conditions)
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { id: SYSTEM_TENANT_ID },
        select: { id: true },
      });

      if (existingTenant) {
        this.logger.log(`System tenant already exists: ${SYSTEM_TENANT_ID}`);
        return SYSTEM_TENANT_ID;
      }

      // Try to create with fixed subdomain, handling conflicts gracefully
      try {
        await this.prisma.tenant.create({
          data: {
            id: SYSTEM_TENANT_ID,
            name: 'System API Keys',
            subdomain: SYSTEM_SUBDOMAIN,
            plan: 'ENTERPRISE',
            status: 'ACTIVE',
            description: 'System tenant for global API keys',
          },
        });
        this.logger.log(`Created system tenant: ${SYSTEM_TENANT_ID}`);
        return SYSTEM_TENANT_ID;
      } catch (createError: any) {
        // If ID conflict (race condition), another request already created it
        if (createError?.code === 'P2002' && createError?.meta?.target?.includes('id')) {
          // Double-check it exists now
          const nowExisting = await this.prisma.tenant.findUnique({
            where: { id: SYSTEM_TENANT_ID },
            select: { id: true },
          });
          if (nowExisting) {
            this.logger.log(`System tenant created by another request (race condition handled): ${SYSTEM_TENANT_ID}`);
            return SYSTEM_TENANT_ID;
          }
          // If still not found, it's a different error
          throw new BadRequestException(`Failed to create system tenant: ${createError.message}`);
        }
        
        // If subdomain conflict, try with timestamp
        if (createError?.code === 'P2002' && createError?.meta?.target?.includes('subdomain')) {
          this.logger.warn(`Subdomain ${SYSTEM_SUBDOMAIN} already exists, trying with timestamp`);
          try {
            await this.prisma.tenant.create({
              data: {
                id: SYSTEM_TENANT_ID,
                name: 'System API Keys',
                subdomain: `${SYSTEM_SUBDOMAIN}-${Date.now()}`,
                plan: 'ENTERPRISE',
                status: 'ACTIVE',
                description: 'System tenant for global API keys',
              },
            });
            this.logger.log(`Created system tenant with timestamped subdomain: ${SYSTEM_TENANT_ID}`);
            return SYSTEM_TENANT_ID;
          } catch (timestampError: any) {
            // If ID conflict here too, check if it exists
            if (timestampError?.code === 'P2002' && timestampError?.meta?.target?.includes('id')) {
              const raceCheck = await this.prisma.tenant.findUnique({
                where: { id: SYSTEM_TENANT_ID },
                select: { id: true },
              });
              if (raceCheck) {
                this.logger.log(`System tenant created by another request (timestamp attempt): ${SYSTEM_TENANT_ID}`);
                return SYSTEM_TENANT_ID;
              }
            }
            throw timestampError;
          }
        }
        
        // Other errors
        throw createError;
      }
    } catch (error: any) {
      this.logger.error('Error ensuring system tenant:', error);
      this.logger.error(`Error code: ${error?.code}, Error message: ${error?.message}`);
      
      // Last resort: use any existing tenant
      try {
        const anyTenant = await this.prisma.tenant.findFirst({
          select: { id: true },
          orderBy: { createdAt: 'asc' }, // Use oldest tenant as fallback
        });
        if (anyTenant) {
          this.logger.warn(`Using existing tenant ${anyTenant.id} for API keys as fallback`);
          return anyTenant.id;
        }
      } catch (fallbackError: any) {
        this.logger.error('Error finding any tenant:', fallbackError);
      }
      
      throw new BadRequestException(`Failed to ensure system tenant for API keys: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Create a new API key (automatically uses system tenant)
   */
  async create(tenantId: string | null, dto: CreateApiKeyDto) {
    try {
      // Verify Prisma client has apiKey model
      if (!this.prisma) {
        this.logger.error('Prisma client not available');
        throw new BadRequestException('Database client not properly initialized. Please restart the server.');
      }
      
      // If no tenantId provided, use system tenant
      const finalTenantId = tenantId || await this.ensureSystemTenant();
      
      // Debug: Log available Prisma models if apiKey is not found
      if (!this.prisma.apiKey) {
        // Try to find all available models by checking for objects with common Prisma methods
        const availableModels: string[] = [];
        for (const key of Object.keys(this.prisma)) {
          if (
            !key.startsWith('$') && 
            !key.startsWith('_') && 
            typeof this.prisma[key] === 'object' && 
            this.prisma[key] !== null &&
            (typeof this.prisma[key].create === 'function' || 
             typeof this.prisma[key].findMany === 'function' ||
             typeof this.prisma[key].findUnique === 'function')
          ) {
            availableModels.push(key);
          }
        }
        
        this.logger.error(`Prisma apiKey model not found. Available models: ${availableModels.sort().join(', ')}`);
        this.logger.error(`Checking for alternative names: apiKey=${!!this.prisma.apiKey}, ApiKey=${!!this.prisma.ApiKey}`);
        this.logger.error(`Prisma client type: ${this.prisma?.constructor?.name || 'unknown'}`);
        this.logger.error(`Prisma client keys (first 20): ${Object.keys(this.prisma).slice(0, 20).join(', ')}`);
        
        throw new BadRequestException(
          `API Key model not found in Prisma client. ` +
          `Found ${availableModels.length} models: ${availableModels.slice(0, 15).join(', ')}. ` +
          `The Prisma client needs to be regenerated. Please run: cd apps/app-core && npx prisma generate && restart the server.`
        );
      }

      if (!finalTenantId) {
        throw new BadRequestException('Failed to determine tenant for API key');
      }

      // Generate API key
      const apiKey = this.generateApiKey();
      const apiKeyHash = await this.hashApiKey(apiKey);
      const apiKeyPrefix = this.getApiKeyPrefix(apiKey);

      // Store in database (only prefix for lookup, full key is hashed)
      const created = await this.prisma.apiKey.create({
        data: {
          name: dto.name,
          apiKey: apiKeyPrefix, // Store prefix for lookup only
          apiKeyHash: apiKeyHash,
          tenantId: finalTenantId,
          isActive: true,
        },
      });

      this.logger.log(`Created API key: ${created.id} for tenant: ${finalTenantId}`);

      // Return with the plain API key (only shown once)
      return {
        id: created.id,
        name: created.name,
        apiKey: apiKey, // Only returned on creation
        isActive: created.isActive,
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
      };
    } catch (error: any) {
      this.logger.error('Error creating API key:', error);
      this.logger.error(`Error stack: ${error?.stack}`);
      this.logger.error(`Prisma client available: ${!!this.prisma}, apiKey model available: ${!!this.prisma?.apiKey}`);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Provide more specific error messages
      if (error?.code === 'P2002') {
        throw new BadRequestException('API key with this name already exists');
      }
      
      throw new BadRequestException(`Failed to create API key: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Find all API keys for a tenant
   */
  async findAll(tenantId: string) {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
        // Never return the actual API key or hash
      },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys;
  }

  /**
   * Find one API key by ID
   */
  async findOne(tenantId: string, id: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return apiKey;
  }

  /**
   * Update an API key
   */
  async update(tenantId: string, id: string, dto: UpdateApiKeyDto) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(`Updated API key: ${id} for tenant: ${tenantId}`);
    return updated;
  }

  /**
   * Delete an API key
   */
  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    this.logger.log(`Deleted API key: ${id} for tenant: ${tenantId}`);
    return { message: 'API key deleted successfully' };
  }

  /**
   * Validate API key and return tenant info
   * Used by authentication guard
   */
  async validateApiKey(apiKey: string): Promise<{ tenantId: string; apiKeyId: string } | null> {
    // Extract prefix for lookup
    const apiKeyPrefix = this.getApiKeyPrefix(apiKey);

    // Find all API keys with matching prefix (since we only store prefix)
    const apiKeyRecords = await this.prisma.apiKey.findMany({
      where: {
        apiKey: apiKeyPrefix,
        isActive: true,
      },
      select: {
        id: true,
        apiKeyHash: true,
        tenantId: true,
        isActive: true,
      },
    });

    // Try to match against all records with same prefix
    for (const apiKeyRecord of apiKeyRecords) {
      const isValid = await this.verifyApiKey(apiKey, apiKeyRecord.apiKeyHash);
      if (isValid) {
        // Update last used timestamp
        await this.prisma.apiKey.update({
          where: { id: apiKeyRecord.id },
          data: { lastUsedAt: new Date() },
        });

        return {
          tenantId: apiKeyRecord.tenantId,
          apiKeyId: apiKeyRecord.id,
        };
      }
    }

    return null;
  }

  /**
   * Regenerate API key (creates new key, invalidates old one)
   */
  async regenerate(tenantId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    // Generate new API key
    const newApiKey = this.generateApiKey();
    const newApiKeyHash = await this.hashApiKey(newApiKey);
    const newApiKeyPrefix = this.getApiKeyPrefix(newApiKey);

    // Update with new key
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        apiKey: newApiKeyPrefix, // Store prefix only
        apiKeyHash: newApiKeyHash,
        lastUsedAt: null, // Reset last used
      },
    });

    this.logger.log(`Regenerated API key: ${id} for tenant: ${tenantId}`);

    return {
      id: updated.id,
      name: updated.name,
      apiKey: newApiKey, // Only returned on regeneration
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      lastUsedAt: updated.lastUsedAt,
    };
  }

  /**
   * Admin methods - no tenant restrictions
   */

  /**
   * Find all API keys from all tenants (for system admin)
   */
  async findAllForAllTenants() {
    try {
      // Use safe query without relation first to avoid Prisma relation errors
      // Fetch API keys without tenant relation
      const apiKeys = await this.prisma.apiKey.findMany({
        select: {
          id: true,
          name: true,
          tenantId: true,
          isActive: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Fetch tenant data separately if we have tenantIds
      const tenantIds = [...new Set(apiKeys.map(k => k.tenantId).filter(Boolean))];
      const tenants = tenantIds.length > 0 
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true, subdomain: true },
          })
        : [];

      const tenantMap = new Map(tenants.map(t => [t.id, t]));

      // Map API keys with tenant data
      return apiKeys.map(key => ({
        ...key,
        tenant: tenantMap.get(key.tenantId) || { name: 'Unknown', subdomain: 'unknown' },
      }));
    } catch (error: any) {
      this.logger.error('Error fetching all API keys:', error);
      this.logger.error(`Error name: ${error?.name}, Error message: ${error?.message}`);
      this.logger.error(`Error code: ${error?.code}`);
      
      // Return empty array instead of throwing to prevent 400 errors
      // This allows the UI to still load even if there's a database issue
      this.logger.warn('Returning empty array due to error');
      return [];
    }
  }

  /**
   * Find one API key by ID (for admin, no tenant check)
   */
  async findOneForAdmin(id: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        tenantId: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            name: true,
            subdomain: true,
          },
        },
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return apiKey;
  }

  /**
   * Update an API key (for admin, no tenant check)
   */
  async updateForAdmin(id: string, dto: UpdateApiKeyDto) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: {
        id: true,
        name: true,
        tenantId: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            name: true,
            subdomain: true,
          },
        },
      },
    });

    this.logger.log(`Admin updated API key: ${id}`);
    return updated;
  }

  /**
   * Delete an API key (for admin, no tenant check)
   */
  async removeForAdmin(id: string) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    this.logger.log(`Admin deleted API key: ${id}`);
    return { message: 'API key deleted successfully' };
  }

  /**
   * Regenerate API key (for admin, no tenant check)
   */
  async regenerateForAdmin(id: string) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    // Generate new API key
    const newApiKey = this.generateApiKey();
    const newApiKeyHash = await this.hashApiKey(newApiKey);
    const newApiKeyPrefix = this.getApiKeyPrefix(newApiKey);

    // Update with new key
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        apiKey: newApiKeyPrefix, // Store prefix only
        apiKeyHash: newApiKeyHash,
        lastUsedAt: null, // Reset last used
      },
    });

    this.logger.log(`Admin regenerated API key: ${id}`);

    return {
      id: updated.id,
      name: updated.name,
      apiKey: newApiKey, // Only returned on regeneration
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      lastUsedAt: updated.lastUsedAt,
    };
  }
}


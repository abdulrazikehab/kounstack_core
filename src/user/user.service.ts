// apps/app-core/src/user/user.service.ts
import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: string;
  createdAt: Date;
  tenant?: {
    id: string;
    name: string;
    subdomain: string;
    plan: string;
    status: string;
  };
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService) {}

  async getProfile(tenantId: string, userId: string): Promise<UserProfile> {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
              subdomain: true,
              plan: true,
              status: true,
            },
          },
        },
      });

      if (!user) {
        this.logger.warn(`User not found: ${userId} in tenant: ${tenantId}`);
        throw new NotFoundException('User not found');
      }

      return user as UserProfile;
    } catch (error) {
      this.logger.error(`Error fetching user profile: ${error}`);
      throw error;
    }
  }

  async updateProfile(
    tenantId: string, 
    userId: string, 
    updateData: { email?: string; name?: string; avatar?: string }
  ) {
    try {
      // Verify user exists and belongs to tenant
      const existingUser = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
      });

      if (!existingUser) {
        // SECURITY: Generic message prevents enumeration of valid user IDs
        throw new NotFoundException('Access denied or resource not found');
      }

      // Check if email is already taken by another user in the same tenant
      if (updateData.email && updateData.email !== existingUser.email) {
        const emailExists = await this.prisma.user.findFirst({
          where: {
            email: updateData.email,
            tenantId,
            id: { not: userId },
          },
        });

        if (emailExists) {
          throw new NotFoundException('Email already taken');
        }
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      this.logger.log(`User profile updated: ${userId}`);
      return updatedUser;
    } catch (error) {
      this.logger.error(`Error updating user profile: ${error}`);
      throw error;
    }
  }

  async getUserById(tenantId: string, userId: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        // SECURITY: Generic message prevents enumeration
        throw new NotFoundException('Access denied or resource not found');
      }

      return user;
    } catch (error) {
      this.logger.error(`Error fetching user by ID: ${error}`);
      throw error;
    }
  }

  async getUsersByTenant(tenantId: string, page: number = 1, limit: number = 50, role?: string) {
    try {
      const skip = (page - 1) * limit;

      const where: any = { tenantId };
      if (role) {
        where.role = role;
      }

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count({
          where,
        }),
      ]);

      return {
        data: users,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching users by tenant: ${error}`);
      throw error;
    }
  }

  async updateUser(
    tenantId: string,
    userId: string,
    updateData: { email?: string; name?: string; role?: string; avatar?: string },
    updatedBy: string
  ) {
    try {
      // Verify user exists and belongs to tenant
      const existingUser = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
      });

      if (!existingUser) {
        // SECURITY: Generic message prevents enumeration
        throw new NotFoundException('Access denied or resource not found');
      }

      // Check if user has permission to update roles (only SHOP_OWNER or SUPER_ADMIN)
      if (updateData.role) {
        const updatingUser = await this.prisma.user.findFirst({
          where: {
            id: updatedBy,
            tenantId,
            role: { in: ['SHOP_OWNER', 'SUPER_ADMIN'] },
          },
        });

        if (!updatingUser) {
          throw new NotFoundException('Insufficient permissions to update user role');
        }
      }

      // Check if email is already taken by another user in the same tenant
      if (updateData.email && updateData.email !== existingUser.email) {
        const emailExists = await this.prisma.user.findFirst({
          where: {
            email: updateData.email,
            tenantId,
            id: { not: userId },
          },
        });

        if (emailExists) {
          throw new NotFoundException('Email already taken');
        }
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(updateData.email && { email: updateData.email }),
          ...(updateData.name !== undefined && { name: updateData.name }),
          ...(updateData.role && { role: updateData.role as any }),
          ...(updateData.avatar !== undefined && { avatar: updateData.avatar }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      this.logger.log(`User updated: ${userId} by ${updatedBy}`);
      return updatedUser;
    } catch (error) {
      this.logger.error(`Error updating user: ${error}`);
      throw error;
    }
  }

  async deactivateUser(tenantId: string, userId: string, deactivatedBy: string) {
    try {
      // Verify user exists and belongs to tenant
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
      });

      if (!user) {
        // SECURITY: Generic message prevents enumeration
        throw new NotFoundException('Access denied or resource not found');
      }

      // Prevent self-deactivation
      if (userId === deactivatedBy) {
        throw new NotFoundException('Cannot deactivate your own account');
      }

      // In a real scenario, you might soft delete or update status
      // For now, we'll just delete refresh tokens
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });

      this.logger.log(`User deactivated: ${userId} by ${deactivatedBy}`);
      return { message: 'User deactivated successfully' };
    } catch (error) {
      this.logger.error(`Error deactivating user: ${error}`);
      throw error;
    }
  }

  /**
   * Ensure user exists in core database (sync from auth database)
   * This is needed because users are created in auth database but merchants need them in core database
   */
  async ensureUserExists(userId: string, userData: { email: string; name?: string; role?: string; tenantId?: string }): Promise<any> {
    try {
      // Check if user already exists by ID
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      // If user not found by ID, check by tenantId and email (handle cases where user was created with different ID)
      // This handles scenarios where the same email might have been used with different user IDs in DIFFERENT tenants
      if (!user && userData.email && userData.tenantId) {
        const userByEmail = await this.prisma.user.findFirst({
          where: { 
            email: userData.email,
            tenantId: userData.tenantId
          },
        });
        
        if (userByEmail) {
          // User exists with same email in SAME tenant but potentially different ID
          // Use the existing user to avoid conflicts and maintain data integrity
          this.logger.warn(`User with email ${userData.email} exists in tenant ${userData.tenantId} with ID ${userByEmail.id} (JWT has ${userId}). Using existing user.`);
          user = userByEmail;
          
          // Update user data if needed (name, role)
          const updateData: any = {};
          if (userData.name && user.name !== userData.name) updateData.name = userData.name;
          if (userData.role && user.role !== userData.role) updateData.role = userData.role as any;
          
          if (Object.keys(updateData).length > 0) {
            user = await this.prisma.user.update({
              where: { id: user.id },
              data: updateData,
            });
            this.logger.log(`Updated user ${user.id} with new data`);
          }
          
          return user;
        }
      }

      if (user) {
        // Update user if data changed
        const updateData: any = {};
        if (userData.email && user.email !== userData.email) updateData.email = userData.email;
        if (userData.name && user.name !== userData.name) updateData.name = userData.name;
        if (userData.role && user.role !== userData.role) updateData.role = userData.role as any;
        
        // Only update tenantId if tenant exists (to avoid foreign key constraint)
        if (userData.tenantId && user.tenantId !== userData.tenantId) {
          // Retry check up to 3 times with small delay (handles potential transaction timing issues)
          let tenantExists = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            tenantExists = await this.prisma.tenant.findUnique({
              where: { id: userData.tenantId },
            });
            if (tenantExists) break;
            if (attempt < 2) {
              // Wait 100ms before retry (only if not last attempt)
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          if (tenantExists) {
            updateData.tenantId = userData.tenantId;
          } else {
            this.logger.warn(`Tenant ${userData.tenantId} does not exist after retries, skipping tenantId update for user ${userId}`);
          }
        }

        if (Object.keys(updateData).length > 0) {
          user = await this.prisma.user.update({
            where: { id: userId },
            data: updateData,
          });
          this.logger.log(`Updated user ${userId} in core database`);
        }
        return user;
      }

      // Create user if doesn't exist
      // SECURITY NOTE: Password is only stored in auth database, not core database
      // This placeholder is safe - authentication always occurs via auth service
      // The core database user record is for reference/relationships only
      const createData: any = {
        id: userId,
        email: userData.email,
        password: 'SYNCED_FROM_AUTH', // SECURITY: Safe placeholder - real auth happens in auth DB
        role: (userData.role as any) || 'SHOP_OWNER',
      };

      // Add name only if provided (it's optional)
      if (userData.name) {
        createData.name = userData.name;
      }

      // Only set tenantId if tenant exists (to avoid foreign key constraint)
      if (userData.tenantId) {
        const tenantExists = await this.prisma.tenant.findUnique({
          where: { id: userData.tenantId },
        });
        if (tenantExists) {
          createData.tenantId = userData.tenantId;
        } else {
          this.logger.warn(`Tenant ${userData.tenantId} does not exist yet, creating user without tenantId`);
        }
      }

      user = await this.prisma.user.create({
        data: createData,
      });

      // If tenantId was provided but not set, update it now (tenant might have been created in parallel)
      if (userData.tenantId && !user.tenantId) {
        try {
          const tenantExists = await this.prisma.tenant.findUnique({
            where: { id: userData.tenantId },
          });
          if (tenantExists) {
            user = await this.prisma.user.update({
              where: { id: userId },
              data: { tenantId: userData.tenantId },
            });
            this.logger.log(`Updated user ${userId} with tenantId ${userData.tenantId}`);
          }
        } catch (updateError) {
          // Non-fatal - user is created, tenantId can be updated later
          this.logger.warn(`Could not update tenantId for user ${userId}: ${updateError}`);
        }
      }

      this.logger.log(`Created user ${userId} in core database (synced from auth)`);
      return user;
    } catch (error: any) {
      // If unique constraint error
      if (error?.code === 'P2002') {
        // Check if it's email conflict
        if (error.meta?.target?.includes('email')) {
          this.logger.warn(`Email conflict for user ${userId} with email ${userData.email} in tenant ${userData.tenantId}`);
          // Try to find the conflicting user by email and tenant
          const conflictingUser = await this.prisma.user.findFirst({ 
            where: { 
              email: userData.email,
              tenantId: userData.tenantId 
            } 
          });
          if (conflictingUser) {
            // If the conflicting user has the same ID, it's the same user - just return it
            if (conflictingUser.id === userId) {
              this.logger.log(`User ${userId} already exists with same email - returning existing user`);
              // Update tenantId if needed
              if (userData.tenantId && !conflictingUser.tenantId) {
                try {
                  const tenantExists = await this.prisma.tenant.findUnique({
                    where: { id: userData.tenantId },
                  });
                  if (tenantExists) {
                    const updated = await this.prisma.user.update({
                      where: { id: userId },
                      data: { tenantId: userData.tenantId },
                    });
                    return updated;
                  }
                } catch (updateError) {
                  this.logger.warn(`Could not update tenantId for user ${userId}: ${updateError}`);
                }
              }
              return conflictingUser;
            }
            // If different ID, it's a real conflict - but check if the requested user ID exists first
            const requestedUser = await this.prisma.user.findUnique({ where: { id: userId } });
            if (requestedUser) {
              // User exists with the requested ID - return it (email might have changed)
              this.logger.log(`User ${userId} exists but email conflict - returning user by ID`);
              return requestedUser;
            }
            // Real conflict: different user has this email
            this.logger.error(`Email ${userData.email} is used by different user ${conflictingUser.id} (requested: ${userId})`);
            throw new BadRequestException(`Email ${userData.email} is already used by another account. Please contact support.`);
          }
        }

        // For other unique constraint errors (like ID conflict), try to fetch the existing user
        this.logger.log(`User ${userId} may have been created by another request - fetching existing user`);
        const existingUser = await this.prisma.user.findUnique({ where: { id: userId } });
        if (existingUser) {
          return existingUser;
        }
      }
      this.logger.error(`Error ensuring user exists: ${error}`);
      throw error;
    }
    }

  async deleteUserByEmail(tenantId: string, email: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          email: email.toLowerCase().trim(),
          tenantId,
          role: 'CUSTOMER',
        },
      });

      if (user) {
        await this.prisma.user.delete({
          where: { id: user.id },
        });
        this.logger.log(`User deleted by email: ${email}`);
        return { message: 'User deleted successfully' };
      }
      return { message: 'User not found' };
    } catch (error) {
      this.logger.error(`Error deleting user by email: ${error}`);
      // Don't throw - this is a cleanup operation
      return { message: 'User deletion attempted' };
    }
  }
}
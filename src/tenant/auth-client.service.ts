import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthClientService {
  private readonly logger = new Logger(AuthClientService.name);
  private readonly authServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL') || 'http://localhost:3001';
  }

  async checkCanCreateMarket(userId: string, accessToken: string): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets/can-create`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Auth service returned ${response.status}`);
      }

      const result = await response.json() as { allowed: boolean; currentCount: number; limit: number };
      return result;
    } catch (error) {
      this.logger.error(`Failed to check market limit for user ${userId}:`, error);
      throw error;
    }
  }

  async linkUserToTenant(userId: string, tenantId: string, accessToken: string): Promise<void> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets/link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, tenantId }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to link user to tenant: ${error}`);
      }
    } catch (error) {
      this.logger.error(`Failed to link user ${userId} to tenant ${tenantId}:`, error);
      throw error;
    }
  }

  async createTenantAndLink(userId: string, tenantData: { id: string; name: string; subdomain: string; plan?: string; status?: string }, accessToken: string): Promise<any> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tenantData),
      });

      if (!response.ok) {
        let errorMessage = `Auth service returned ${response.status}`;
        try {
          const errorData = await response.json() as any;
          errorMessage = errorData.message || errorData.error || errorMessage;
          
          if (response.status === 409) {
            throw new Error(`Conflict: ${errorMessage}`);
          }
        } catch (e: any) {
          if (e.message?.startsWith('Conflict:')) throw e;
          // If JSON parsing fails, try text
          try {
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
          } catch {}
        }
        
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to create tenant and link for user ${userId}:`, error);
      throw error;
    }
  }

  async updateTenant(tenantId: string, data: { name?: string; logo?: string; subdomain?: string }, accessToken: string): Promise<any> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets/${tenantId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        let errorMessage = `Auth service returned ${response.status}`;
        try {
          const errorData = await response.json() as any;
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
             // ignore
        }
        
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to update tenant ${tenantId}:`, error);
      // Consume error to prevent blocking main flow? 
      // User might be updating config, if sync fails, maybe just warn.
      // But for now, log and rethrow might be okay or catch in caller.
      throw error;
    }
  }

  async getUserMarkets(userId: string, accessToken: string): Promise<Array<{ id: string; name: string; subdomain: string; description?: string; plan: string; status: string; createdAt: string; isOwner: boolean; isActive: boolean }>> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Auth service returned ${response.status}`);
      }

      return await response.json() as any;
    } catch (error) {
      this.logger.error(`Failed to get markets for user ${userId}:`, error);
      throw error;
    }
  }

  async deleteTenant(tenantId: string, accessToken: string): Promise<void> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/markets/${tenantId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorMessage = `Auth service returned ${response.status}`;
        try {
          const errorData = await response.json() as any;
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // If JSON parsing fails, try text
          try {
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
          } catch {
            // Ignore if text parsing also fails
          }
        }
        
        // Preserve status code information in error message
        if (response.status === 401) {
          throw new Error(`Authentication failed: ${errorMessage}`);
        } else if (response.status === 403) {
          throw new Error(`Permission denied: ${errorMessage}`);
        } else if (response.status === 404) {
          throw new Error(`Market not found: ${errorMessage}`);
        } else {
          throw new Error(`Failed to delete tenant: ${errorMessage}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to delete tenant ${tenantId}:`, error);
      throw error;
    }
  }
}


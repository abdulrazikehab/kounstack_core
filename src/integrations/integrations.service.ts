import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationType } from '@prisma/client';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  async getIntegrations(tenantId: string) {
    try {
      const integrations = await this.prisma.integration.findMany({
        where: {
          tenantId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return integrations.map((integration) => ({
        id: integration.id,
        name: integration.name,
        type: integration.type,
        provider: integration.provider,
        isActive: integration.isActive,
        createdAt: integration.createdAt,
        config: integration.settings || {},
      }));
    } catch (error) {
      this.logger.error(`Error fetching integrations: ${error}`);
      throw error;
    }
  }

  async createIntegration(
    tenantId: string,
    data: { name: string; type: string; provider: string; config?: any; credentials?: any }
  ) {
    try {
      // Validate integration type
      if (!Object.values(IntegrationType).includes(data.type as IntegrationType)) {
        throw new BadRequestException(`Invalid integration type: ${data.type}`);
      }

      const integration = await this.prisma.integration.create({
        data: {
          tenantId,
          name: data.name,
          type: data.type as IntegrationType,
          provider: data.provider,
          credentials: data.credentials || {},
          settings: data.config || {},
          isActive: true,
        },
      });

      this.logger.log(`Integration created: ${integration.id} for tenant ${tenantId}`);
      return {
        id: integration.id,
        name: integration.name,
        type: integration.type,
        provider: integration.provider,
        isActive: integration.isActive,
        createdAt: integration.createdAt,
      };
    } catch (error) {
      this.logger.error(`Error creating integration: ${error}`);
      throw error;
    }
  }

  async updateIntegration(
    tenantId: string,
    id: string,
    data: { name?: string; isActive?: boolean; config?: any; credentials?: any }
  ) {
    try {
      // Verify integration exists and belongs to tenant
      const existing = await this.prisma.integration.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!existing) {
        throw new NotFoundException('Integration not found');
      }

      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.config !== undefined) updateData.settings = data.config;
      if (data.credentials !== undefined) updateData.credentials = data.credentials;

      const integration = await this.prisma.integration.update({
        where: { id },
        data: updateData,
      });

      this.logger.log(`Integration updated: ${id} for tenant ${tenantId}`);
      return {
        id: integration.id,
        name: integration.name,
        type: integration.type,
        provider: integration.provider,
        isActive: integration.isActive,
        createdAt: integration.createdAt,
      };
    } catch (error) {
      this.logger.error(`Error updating integration: ${error}`);
      throw error;
    }
  }

  async deleteIntegration(tenantId: string, id: string) {
    try {
      // Verify integration exists and belongs to tenant
      const existing = await this.prisma.integration.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!existing) {
        throw new NotFoundException('Integration not found');
      }

      await this.prisma.integration.delete({
        where: { id },
      });

      this.logger.log(`Integration deleted: ${id} for tenant ${tenantId}`);
      return { message: 'Integration deleted successfully' };
    } catch (error) {
      this.logger.error(`Error deleting integration: ${error}`);
      throw error;
    }
  }
}


import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOptionsService {
  private readonly logger = new Logger(PaymentOptionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all payment options for a tenant
   * Returns all available payment gateways (both global and tenant-specific) with their enabled status
   */
  async getPaymentOptions(tenantId: string) {
    // Get all available payment gateways (global ones with tenantId=null and tenant-specific ones)
    const allGateways = await this.prisma.paymentMethod.findMany({
      where: {
        OR: [
          { tenantId: null }, // Global gateways from admin panel
          { tenantId }, // Tenant-specific gateways
        ],
        isActive: true, // Only active gateways
      },
      orderBy: [
        { tenantId: 'asc' }, // Global first, then tenant-specific
        { createdAt: 'desc' },
      ],
    });

    // Get tenant's payment option settings
    const tenantOptions = await this.prisma.tenantPaymentOption.findMany({
      where: { tenantId },
      include: {
        paymentMethod: true,
      },
    });

    // Create a map of enabled payment methods
    const enabledMap = new Map(
      tenantOptions
        .filter(opt => opt.isEnabled)
        .map(opt => [opt.paymentMethodId, opt])
    );

    // Combine gateways with their enabled status
    const options = allGateways.map(gateway => {
      const option = enabledMap.get(gateway.id);
      return {
        id: gateway.id,
        paymentMethodId: gateway.id,
        provider: gateway.provider,
        name: gateway.name,
        isEnabled: option?.isEnabled || false,
        displayOrder: option?.displayOrder || 0,
        isGlobal: gateway.tenantId === null,
        credentials: gateway.credentials,
        settings: gateway.settings,
        createdAt: gateway.createdAt,
        updatedAt: option?.updatedAt || gateway.updatedAt,
      };
    });

    // Sort by display order, then by creation date
    return options.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  /**
   * Add or update a payment option for a tenant
   */
  async setPaymentOption(
    tenantId: string,
    paymentMethodId: string,
    data: { isEnabled: boolean; displayOrder?: number }
  ) {
    // Verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Verify payment method exists and is available (global or tenant-specific)
    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        OR: [
          { tenantId: null }, // Global gateway
          { tenantId }, // Tenant-specific gateway
        ],
        isActive: true,
      },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found or not available for this tenant');
    }

    // Upsert the payment option
    const option = await this.prisma.tenantPaymentOption.upsert({
      where: {
        tenantId_paymentMethodId: {
          tenantId,
          paymentMethodId,
        },
      },
      create: {
        tenantId,
        paymentMethodId,
        isEnabled: data.isEnabled,
        displayOrder: data.displayOrder || 0,
      },
      update: {
        isEnabled: data.isEnabled,
        displayOrder: data.displayOrder ?? undefined,
      },
      include: {
        paymentMethod: true,
      },
    });

    this.logger.log(`Payment option ${data.isEnabled ? 'enabled' : 'disabled'} for tenant ${tenantId}: ${paymentMethod.name}`);

    return {
      id: option.id,
      paymentMethodId: option.paymentMethodId,
      provider: option.paymentMethod.provider,
      name: option.paymentMethod.name,
      isEnabled: option.isEnabled,
      displayOrder: option.displayOrder,
      isGlobal: option.paymentMethod.tenantId === null,
    };
  }

  /**
   * Toggle a payment option for a tenant
   */
  async togglePaymentOption(tenantId: string, paymentMethodId: string) {
    // Get current option
    const option = await this.prisma.tenantPaymentOption.findUnique({
      where: {
        tenantId_paymentMethodId: {
          tenantId,
          paymentMethodId,
        },
      },
    });

    if (option) {
      // Toggle existing option
      return this.setPaymentOption(tenantId, paymentMethodId, {
        isEnabled: !option.isEnabled,
        displayOrder: option.displayOrder,
      });
    } else {
      // Create new option enabled
      return this.setPaymentOption(tenantId, paymentMethodId, {
        isEnabled: true,
        displayOrder: 0,
      });
    }
  }

  /**
   * Get enabled payment options for a tenant (for mobile app)
   */
  async getEnabledPaymentOptions(tenantId: string) {
    const options = await this.getPaymentOptions(tenantId);
    return options.filter(opt => opt.isEnabled);
  }

  /**
   * Bulk update payment options for a tenant
   */
  async bulkUpdatePaymentOptions(
    tenantId: string,
    updates: Array<{ paymentMethodId: string; isEnabled: boolean; displayOrder?: number }>
  ) {
    // Verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const results = [];

    for (const update of updates) {
      try {
        const result = await this.setPaymentOption(tenantId, update.paymentMethodId, {
          isEnabled: update.isEnabled,
          displayOrder: update.displayOrder,
        });
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to update payment option ${update.paymentMethodId}:`, error);
        // Continue with other updates
      }
    }

    return results;
  }
}


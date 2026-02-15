import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShippingService {
  constructor(private prisma: PrismaService) {}

  async calculateRate(tenantId: string, address: any, items: any[]): Promise<number> {
    if (!address || !address.country) {
      // Default fallback if no address provided
      return 10;
    }

    // Find matching zone
    const zone = await this.prisma.shippingZone.findFirst({
      where: {
        tenantId,
        isActive: true,
        countries: { has: address.country },
      },
      include: { methods: { where: { isActive: true } } },
    });

    if (!zone || !zone.methods.length) {
      // Fallback to "Rest of World" or default
      const defaultZone = await this.prisma.shippingZone.findFirst({
        where: { tenantId, name: 'Rest of World', isActive: true },
        include: { methods: { where: { isActive: true } } },
      });

      if (!defaultZone || !defaultZone.methods.length) {
        return 15; // Global default fallback
      }
      
      return this.calculateBestRate(defaultZone.methods, items);
    }

    return this.calculateBestRate(zone.methods, items);
  }

  private calculateBestRate(methods: any[], items: any[]): number {
    // Simple logic: find the cheapest applicable method
    // In a real app, user would select the method. Here we return the default/cheapest.
    
    let bestRate = Infinity;
    const cartTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    for (const method of methods) {
      let rate = Number(method.price);

      // Check for free shipping threshold
      if (method.minimumAmount && cartTotal >= Number(method.minimumAmount)) {
        rate = 0;
      }

      if (rate < bestRate) {
        bestRate = rate;
      }
    }

    return bestRate === Infinity ? 15 : bestRate;
  }
}

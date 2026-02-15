import { Controller, Post, Body, Param } from '@nestjs/common';
import { ShippingService } from './shipping.service';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('calculate/:tenantId')
  async calculateRate(
    @Param('tenantId') tenantId: string,
    @Body() payload: { address: any; items: any[] },
  ) {
    const { address, items } = payload;
    return { rate: await this.shippingService.calculateRate(tenantId, address, items) };
  }
}

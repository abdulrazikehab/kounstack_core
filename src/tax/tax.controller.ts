import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { TaxService } from './tax.service';

@Controller('tax')
export class TaxController {
  constructor(private readonly taxService: TaxService) {}

  @Get('calculate/:tenantId')
  async calculateTax(
    @Param('tenantId') tenantId: string,
    @Query('amount') amount: number,
    @Query('country') country: string,
    @Query('state') state?: string,
  ) {
    return this.taxService.calculateTax(tenantId, Number(amount), country, state);
  }

  @Get('rates/:tenantId')
  async getTaxRates(@Param('tenantId') tenantId: string) {
    return this.taxService.getTaxRates(tenantId);
  }
}
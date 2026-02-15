import { Controller, Get, Post, Body, Patch, Param, Delete, Request, UseGuards } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Post()
  create(@Request() req: any, @Body() createCouponDto: any) {
    const tenantId = req.user?.tenantId || 'default-tenant-id';
    return this.couponService.create(tenantId, createCouponDto);
  }

  @Get()
  findAll(@Request() req: any) {
    const tenantId = req.user?.tenantId || 'default-tenant-id';
    return this.couponService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || 'default-tenant-id';
    return this.couponService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() updateCouponDto: any) {
    const tenantId = req.user?.tenantId || 'default-tenant-id';
    return this.couponService.update(tenantId, id, updateCouponDto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || 'default-tenant-id';
    return this.couponService.remove(tenantId, id);
  }
}

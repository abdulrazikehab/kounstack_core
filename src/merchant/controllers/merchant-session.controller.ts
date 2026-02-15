import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MerchantSessionService } from '../services/merchant-session.service';
import { MerchantService } from '../services/merchant.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../../guard/tenant-required.guard';

@Controller('merchant/sessions')
@UseGuards(JwtAuthGuard, TenantRequiredGuard)
export class MerchantSessionController {
  constructor(
    private readonly sessionService: MerchantSessionService,
    private readonly merchantService: MerchantService,
  ) {}

  @Get()
  async findAll(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    // Only owner can view all sessions
    if (!context.isOwner) {
      return [];
    }

    return this.sessionService.findAll(context.merchantId);
  }

  @Patch(':id/trust')
  async setTrust(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { isTrusted: boolean },
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    // Only owner can trust sessions
    if (!context.isOwner) {
      throw new Error('Only merchant owner can manage sessions');
    }

    return this.sessionService.setTrust(context.merchantId, id, body.isTrusted);
  }

  @Delete(':id')
  async revoke(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.id || req.user.userId;
    const context = await this.merchantService.validateMerchantAccess(userId);

    // Only owner can revoke sessions
    if (!context.isOwner) {
      throw new Error('Only merchant owner can manage sessions');
    }

    return this.sessionService.revoke(context.merchantId, id);
  }
}


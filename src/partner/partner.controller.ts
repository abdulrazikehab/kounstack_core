import { Controller, Post, Get, Body, UseGuards, Request, BadRequestException, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PartnerService } from './partner.service';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('partner')
@UseGuards(JwtAuthGuard)
export class PartnerController {
  private readonly logger = new Logger(PartnerController.name);

  constructor(private readonly partnerService: PartnerService) {}

  @Post('marketplace')
  async createMarketplace(
    @Request() req: AuthenticatedRequest,
    @Body() createMarketplaceDto: CreateMarketplaceDto,
  ) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
      return this.partnerService.createMarketplace(tenantId, createMarketplaceDto);
    } catch (error: any) {
      this.logger.error('Error creating marketplace:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create marketplace: ${error?.message || 'Unknown error'}`);
    }
  }

  @Get('status')
  async getPartnerStatus(@Request() req: AuthenticatedRequest) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!tenantId) {
        this.logger.warn('Tenant ID missing in request', { user: req.user });
        throw new BadRequestException('Tenant ID is required. Please ensure you are authenticated.');
      }
      return this.partnerService.getPartnerStatus(tenantId);
    } catch (error: any) {
      this.logger.error('Error getting partner status:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to get partner status: ${error?.message || 'Unknown error'}`);
    }
  }
}

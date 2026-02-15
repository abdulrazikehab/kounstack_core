import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Headers,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { AppBuilderService } from './app-builder.service';

interface BuildRequestDto {
  appName: string;
  packageId?: string;
  storeUrl: string;
  primaryColor?: string;
  secondaryColor?: string;
  iconUrl?: string;
  platform?: 'android' | 'ios' | 'both';
}

@Controller('app-builder')
@UseGuards(JwtAuthGuard)
export class AppBuilderController {
  constructor(private readonly appBuilderService: AppBuilderService) {}

  /**
   * Start a new APK build
   */
  @Post('build')
  async startBuild(@Req() req: any, @Body() body: BuildRequestDto) {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      throw new HttpException('Tenant ID required', HttpStatus.BAD_REQUEST);
    }

    if (!body.storeUrl) {
      throw new HttpException('Store URL is required', HttpStatus.BAD_REQUEST);
    }

    // Validate URL
    try {
      new URL(body.storeUrl);
    } catch {
      throw new HttpException('Invalid store URL', HttpStatus.BAD_REQUEST);
    }

    const result = await this.appBuilderService.startBuild(tenantId, {
      appName: body.appName || 'My Store',
      packageId: body.packageId || `com.koun.store.${tenantId.slice(0, 8)}`,
      storeUrl: body.storeUrl,
      primaryColor: body.primaryColor || '#6366f1',
      secondaryColor: body.secondaryColor || '#4f46e5',
      iconUrl: body.iconUrl,
      platform: body.platform,
    });

    return {
      success: true,
      message: 'Build started',
      buildId: result.buildId,
    };
  }

  /**
   * Get build status
   */
  @Get('build/:buildId/status')
  async getBuildStatus(@Param('buildId') buildId: string) {
    const status = await this.appBuilderService.getBuildStatus(buildId);
    
    if (!status) {
      throw new HttpException('Build not found', HttpStatus.NOT_FOUND);
    }

    return status;
  }

  /**
   * Get all builds for current tenant
   */
  @Get('builds')
  async getTenantBuilds(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      throw new HttpException('Tenant ID required', HttpStatus.BAD_REQUEST);
    }

    const builds = await this.appBuilderService.getTenantBuilds(tenantId);
    return { builds };
  }

  /**
   * Save App Configuration
   */
  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new HttpException('Tenant ID required', HttpStatus.BAD_REQUEST);
    }
    const config = await this.appBuilderService.saveConfig(tenantId, body);
    return { success: true, config };
  }

  /**
   * Get App Configuration
   */
  @Public()
  @Get('config')
  async getConfig(
    @Req() req: any, 
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('tenantId') queryTenantId: string
  ) {
    const tenantId = queryTenantId || req.user?.tenantId || req.tenantId || tenantIdHeader;
    
    if (!tenantId) {
      // If we can't find a tenant ID, return empty config instead of error
      // This allows the frontend to fall back gracefully
      return {};
    }
    
    const config = await this.appBuilderService.getConfig(tenantId);
    return config || {};
  }

  /**
   * Cancel a build
   */
  @Post('build/:buildId/cancel')
  async cancelBuild(@Param('buildId') buildId: string) {
    const cancelled = await this.appBuilderService.cancelBuild(buildId);
    
    if (!cancelled) {
      throw new HttpException('Cannot cancel build', HttpStatus.BAD_REQUEST);
    }

    return { success: true, message: 'Build cancelled' };
  }
}

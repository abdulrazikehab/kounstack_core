import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Headers } from '@nestjs/common';
import { ThemeService } from './theme.service';
import { AiThemeService } from './ai-theme.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';

@Controller('themes')
@UseGuards(JwtAuthGuard)
export class ThemeController {
  constructor(
    private readonly themeService: ThemeService,
    private readonly aiThemeService: AiThemeService,
  ) {}

  @Post()
  create(@Request() req: any, @Body() createThemeDto: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.themeService.create(tenantId, createThemeDto);
  }

  @Public()
  @Get()
  findAll(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
    // This will automatically create default themes if none exist
    return this.themeService.ensureDefaultThemes(tenantId);
  }

  @Public()
  @Get(':id')
  findOne(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Param('id') id: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId || tenantIdHeader || process.env.DEFAULT_TENANT_ID || 'default';
    return this.themeService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() updateThemeDto: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.themeService.update(tenantId, id, updateThemeDto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.themeService.remove(tenantId, id);
  }

  @Post(':id/activate')
  activate(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.themeService.activate(tenantId, id);
  }

  @Post('ai/generate')
  generateAITheme(@Request() req: any, @Body() dto: { prompt: string; style?: string }) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.aiThemeService.generateTheme(tenantId, dto);
  }
}

import { Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { PluginService } from './plugin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';

@Controller('plugins')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PluginController {
  constructor(private readonly pluginService: PluginService) {}

  @Get()
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async findAll(@Request() req: any) {
    return this.pluginService.findAll(req.user.tenantId);
  }

  @Get(':id')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.pluginService.findOne(req.user.tenantId, id);
  }

  @Post(':id/toggle')
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  async toggle(@Request() req: any, @Param('id') id: string) {
    return this.pluginService.toggle(req.user.tenantId, id);
  }
}

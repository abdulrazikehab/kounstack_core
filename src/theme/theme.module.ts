import { Module } from '@nestjs/common';
import { ThemeService } from './theme.service';
import { AiThemeService } from './ai-theme.service';
import { ThemeController } from './theme.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, TenantModule, AuthModule],
  controllers: [ThemeController],
  providers: [ThemeService, AiThemeService],
  exports: [ThemeService],
})
export class ThemeModule {}

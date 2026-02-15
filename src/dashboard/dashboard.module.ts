import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DashboardController } from './dashboard.controller';
import { SiteConfigModule } from '../site-config/site-config.module';
import { PageModule } from '../page/page.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [SiteConfigModule, PageModule, HttpModule],
  controllers: [DashboardController],
  providers: [PrismaService],
})
export class DashboardModule {}

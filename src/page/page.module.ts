import { Module, forwardRef } from '@nestjs/common';
import { PageService } from './page.service';
import { PageController } from './page.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [AuthModule, forwardRef(() => TenantModule)],
  controllers: [PageController],
  providers: [PageService, PrismaService],
  exports: [PageService],
})
export class PageModule {}

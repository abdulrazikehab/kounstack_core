import { Module, forwardRef } from '@nestjs/common';
import { TemplateService } from './template.service';
import { AiTemplateService } from './ai-template.service';
import { TemplateController } from './template.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [PrismaModule, AuthModule, forwardRef(() => TenantModule)],
  controllers: [TemplateController],
  providers: [TemplateService, AiTemplateService],
  exports: [TemplateService, AiTemplateService],
})
export class TemplateModule {}
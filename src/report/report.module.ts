import { Module } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { DynamicReportService } from './dynamic/dynamic-report.service';
import { DynamicReportController } from './dynamic/dynamic-report.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AiModule, AuthModule],
  providers: [ReportService, DynamicReportService],
  controllers: [ReportController, DynamicReportController],
})
export class ReportModule {}

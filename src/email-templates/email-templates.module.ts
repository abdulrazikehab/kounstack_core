import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
import { CustomerProblemEmailService } from './customer-problem-email.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, HttpModule, AuthModule],
  controllers: [EmailTemplatesController],
  providers: [EmailTemplatesService, CustomerProblemEmailService],
  exports: [EmailTemplatesService, CustomerProblemEmailService],
})
export class EmailTemplatesModule {}


import { Module } from '@nestjs/common';
import { KycSettingsController } from './kyc-settings.controller';
import { KycSettingsService } from './kyc-settings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [KycSettingsController],
  providers: [KycSettingsService],
  exports: [KycSettingsService],
})
export class KycSettingsModule {}


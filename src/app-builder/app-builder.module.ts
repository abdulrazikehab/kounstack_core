import { Module } from '@nestjs/common';
import { AppBuilderController } from './app-builder.controller';
import { AppBuilderService } from './app-builder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AppBuilderController],
  providers: [AppBuilderService],
  exports: [AppBuilderService],
})
export class AppBuilderModule {}

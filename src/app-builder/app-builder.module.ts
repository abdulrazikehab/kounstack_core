import { Module } from '@nestjs/common';
import { AppBuilderController } from './app-builder.controller';
import { AppBuilderService } from './app-builder.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppBuilderController],
  providers: [AppBuilderService],
  exports: [AppBuilderService],
})
export class AppBuilderModule {}

import { Module } from '@nestjs/common';
import { CategoryController } from './category.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyModule } from '../api-key/api-key.module';

@Module({
  imports: [PrismaModule, AuthModule, ApiKeyModule],
  controllers: [CategoryController],
})
export class CategoryModule {}
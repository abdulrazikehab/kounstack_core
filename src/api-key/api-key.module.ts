import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule as AuthenticationAuthModule } from '../authentication/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthenticationAuthModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}


import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CloudinaryModule, AuthModule],
  controllers: [MediaController],
})
export class MediaModule {}


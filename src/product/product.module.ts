import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { ProductRepository } from './repositories/product.repository';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    AuthModule,
    TenantModule,
    CloudinaryModule,
  ],
  controllers: [ProductController],
  providers: [
    ProductService,
    PrismaService,
    {
      provide: 'IProductRepository',
      useClass: ProductRepository,
    },
  ],
  exports: [ProductService],
})
export class ProductModule {}
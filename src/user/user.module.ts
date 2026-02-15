import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController, UsersController } from './user.controller';
import { CustomerController } from './customer.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [PrismaModule, AuthModule, HttpModule],
  controllers: [UserController, UsersController, CustomerController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
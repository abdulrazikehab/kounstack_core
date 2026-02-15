// apps/app-core/src/user/user.controller.ts
import { 
  Controller, 
  Get, 
  Put, 
  Body, 
  UseGuards, 
  Request,
  Param,
  ParseUUIDPipe,
  Query,
  ParseIntPipe,
  Delete,
  HttpCode,
  HttpStatus,
  ForbiddenException
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';

@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  async getProfile(@Request() req: any) {
    return this.userService.getProfile(req.user.tenantId, req.user.id);
  }

  @Put('profile')
  async updateProfile(
    @Request() req: any,
    @Body() updateData: { email?: string; name?: string; avatar?: string }
  ) {
    return this.userService.updateProfile(req.user.tenantId, req.user.id, updateData);
  }

  @Get('list')
  async getUsers(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.userService.getUsersByTenant(req.user.tenantId, pageNum, limitNum);
  }
}

// Alias controller for /users endpoint
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async getUsers(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const result = await this.userService.getUsersByTenant(req.user.tenantId, pageNum, limitNum);
    // Return just the data array for compatibility
    return result.data || result;
  }

  @Get(':id')
  async getUserById(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) userId: string
  ) {
    // Users can only view their own profile unless they're SHOP_OWNER or SUPER_ADMIN
    if (req.user.role !== 'SHOP_OWNER' && req.user.role !== 'SUPER_ADMIN' && req.user.id !== userId) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return this.userService.getUserById(req.user.tenantId, userId);
  }

  @Put(':id')
  async updateUser(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() updateData: { email?: string; name?: string; role?: string; avatar?: string }
  ) {
    // Users can only update their own profile unless they're SHOP_OWNER or SUPER_ADMIN
    if (req.user.role !== 'SHOP_OWNER' && req.user.role !== 'SUPER_ADMIN' && req.user.id !== userId) {
      throw new ForbiddenException('You can only update your own profile');
    }
    return this.userService.updateUser(req.user.tenantId, userId, updateData, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateUser(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) userId: string
  ) {
    return this.userService.deactivateUser(req.user.tenantId, userId, req.user.id);
  }
}
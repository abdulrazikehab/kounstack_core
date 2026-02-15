import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() dto: CreateApiKeyDto) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.create(tenantId, dto);
  }

  @Get()
  async findAll(@Request() req: AuthenticatedRequest) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.findOne(tenantId, id);
  }

  @Put(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.remove(tenantId, id);
  }

  @Post(':id/regenerate')
  async regenerate(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.apiKeyService.regenerate(tenantId, id);
  }
}


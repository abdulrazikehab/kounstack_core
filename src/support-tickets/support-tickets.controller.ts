import { Controller, Get, Post, Body, Param, UseGuards, Request, Logger, BadRequestException } from '@nestjs/common';
import { SupportTicketsService } from './support-tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('support-tickets')
@UseGuards(JwtAuthGuard)
export class SupportTicketsController {
  private readonly logger = new Logger(SupportTicketsController.name);

  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Post()
  async create(@Request() req: AuthenticatedRequest, @Body() createTicketDto: CreateTicketDto) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!tenantId) {
        throw new BadRequestException('Tenant ID is missing. Please ensure you are logged in correctly.');
      }
      
      if (!req.user?.id) {
         throw new BadRequestException('User ID is missing');
      }

      return await this.supportTicketsService.create(tenantId, req.user.id, createTicketDto, {
        email: req.user.email,
        role: req.user.role
      });
    } catch (error: any) {
      this.logger.error(`Failed to create ticket: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return this.supportTicketsService.findAll(tenantId, req.user.id, {
      email: req.user.email,
      role: req.user.role
    });
  }

  @Get(':id')
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return this.supportTicketsService.findOne(tenantId, req.user.id, id, {
      email: req.user.email,
      role: req.user.role
    });
  }
  
  @Post(':id/replies')
  async addReply(
    @Request() req: AuthenticatedRequest, 
    @Param('id') id: string, 
    @Body('message') message: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return this.supportTicketsService.addReply(tenantId, req.user.id, id, message, {
      email: req.user.email,
      role: req.user.role
    });
  }

  @Post(':id/close')
  async closeTicket(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('documentation') documentation: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return this.supportTicketsService.close(tenantId, req.user.id, id, documentation, {
      email: req.user.email,
      role: req.user.role
    });
  }
}

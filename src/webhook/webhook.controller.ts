import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly prisma: PrismaService
  ) {}

  @Post('endpoints')
  async registerEndpoint(@Request() req: AuthenticatedRequest, @Body() body: { url: string; events: string[]; secret: string }) {
    const tenantId = req.user.tenantId;
    return this.prisma.webhookEndpoint.create({
      data: {
        tenantId,
        url: body.url,
        events: body.events,
        secret: body.secret,
      },
    });
  }
}

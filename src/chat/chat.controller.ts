import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  async list(@Request() req: any) {
    return this.chat.recent(req.user.tenantId);
  }

  @Post()
  async send(
    @Request() req: any,
    @Body('content') content: string,
  ) {
    return this.chat.send({
      tenantId: req.user.tenantId,
      senderId: req.user.id,
      content,
    });
  }
}

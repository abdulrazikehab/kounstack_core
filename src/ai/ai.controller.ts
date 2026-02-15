import { Controller, Post, Body, UseGuards, Query, Request } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(
    @Request() req: AuthenticatedRequest,
    @Body() chatMessageDto: ChatMessageDto
  ) {
    return this.aiService.chat(chatMessageDto, req.tenantId);
  }

  @Post('suggestions')
  async getSuggestions(@Query('sectionType') sectionType: string) {
    return this.aiService.getSuggestions(sectionType);
  }
  @Post('generate-text')
  async generateText(@Body() body: { prompt: string; type: string }) {
    return this.aiService.generateText(body.prompt, body.type);
  }

  @Post('generate-design')
  async generateDesign(@Body() body: { prompt: string }) {
    return this.aiService.generateDesign(body.prompt);
  }

  @Post('analyze-receipt')
  async analyzeReceipt(@Body() body: { imageUrl: string }) {
    console.log('[AiController] Analyzing receipt for URL:', body.imageUrl ? body.imageUrl.substring(0, 50) + '...' : 'null');
    return this.aiService.analyzeReceipt(body.imageUrl);
  }
}

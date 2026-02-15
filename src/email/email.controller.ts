import { Controller, Post, Body, Logger, BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private readonly emailService: EmailService) {}

  @Post('contact')
  async sendContactEmail(@Body() data: {
    to: string;
    from: string;
    fromName: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    try {
      if (!data.to || !data.from || !data.subject || !data.html) {
        throw new BadRequestException('Missing required fields: to, from, subject, html');
      }

      const result = await this.emailService.sendEmail(
        data.to,
        `[From: ${data.fromName} <${data.from}>] ${data.subject}`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p><strong>From:</strong> ${data.fromName} (${data.from})</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            ${data.html}
          </div>
        `,
        data.text || data.html.replace(/<[^>]*>/g, '')
      );

      return {
        success: true,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
      };
    } catch (error: any) {
      this.logger.error('Failed to send contact email:', error);
      throw new BadRequestException(`Failed to send email: ${error?.message || 'Unknown error'}`);
    }
  }

  @Post('send')
  async sendEmail(@Body() data: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    fromName?: string;
    tenantId?: string;
  }) {
    try {
      if (!data.to || !data.subject || !data.html) {
        throw new BadRequestException('Missing required fields: to, subject, html');
      }

      const result = await this.emailService.sendEmail(
        data.to,
        data.subject,
        data.html,
        data.text,
        data.fromName,
        data.tenantId
      );

      return {
        success: true,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
      };
    } catch (error: any) {
      this.logger.error('Failed to send email:', error);
      throw new BadRequestException(`Failed to send email: ${error?.message || 'Unknown error'}`);
    }
  }
}


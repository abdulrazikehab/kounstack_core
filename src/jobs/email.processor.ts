import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process()
  async handleEmail(job: Job<any>) {
    const { to, subject, body } = job.data;
    this.logger.log(`Sending email to ${to} with subject: ${subject}`);
    // Integration with SendGrid/AWS SES would go here
    // await this.emailService.send(...)
  }
}

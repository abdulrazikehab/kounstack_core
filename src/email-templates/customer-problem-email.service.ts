import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from './email-templates.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface CustomerProblem {
  id: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  problemDetails: string;
  supplierId: string;
  supplierName: string;
  supplierResponseDays: number;
  reportedAt: Date;
}

@Injectable()
export class CustomerProblemEmailService {
  private readonly logger = new Logger(CustomerProblemEmailService.name);

  constructor(
    private prisma: PrismaService,
    private emailTemplatesService: EmailTemplatesService,
    private httpService: HttpService,
  ) {}

  /**
   * Send email to customer about problem response
   * This should be called after (supplier response days + 1) from when the problem was reported
   */
  async sendCustomerProblemEmail(
    tenantId: string,
    problem: CustomerProblem,
  ): Promise<void> {
    try {
      // Get email template
      const template = await this.emailTemplatesService.getCustomerProblemTemplate(tenantId);

      if (!template.isActive) {
        this.logger.log(`Email template is inactive for tenant ${tenantId}, skipping email`);
        return;
      }

      // Get tenant/store details
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          siteConfig: true,
        },
      });

      if (!tenant) {
        this.logger.error(`Tenant not found: ${tenantId}`);
        return;
      }

      // Get store logo from site config or settings
      const storeLogo = (tenant.settings as any)?.logo || 
                        (tenant.siteConfig as any)?.logo || 
                        'https://via.placeholder.com/150';
      const storeName = tenant.name;
      const storeDetails = (tenant.settings as any)?.description || 
                          (tenant.siteConfig as any)?.description || 
                          '';

      // Prepare template variables
      const variables = {
        storeName,
        storeLogo,
        storeDetails,
        customerName: problem.customerName,
        supplierResponseDays: problem.supplierResponseDays.toString(),
        problemDetails: problem.problemDetails,
        currentYear: new Date().getFullYear().toString(),
      };

      // Render template (use Arabic if available, otherwise English)
      const subject = template.subjectAr || template.subject;
      const body = template.bodyAr || template.body;

      const renderedSubject = await this.emailTemplatesService.renderTemplate(subject, variables);
      const renderedBody = await this.emailTemplatesService.renderTemplate(body, variables);

      // Send email via auth service
      const authServiceUrl = process.env.AUTH_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
      
      await firstValueFrom(
        this.httpService.post(
          `${authServiceUrl}/email/send`,
          {
            to: problem.customerEmail,
            subject: renderedSubject,
            html: renderedBody,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(`Customer problem email sent to ${problem.customerEmail} for problem ${problem.id}`);
    } catch (error: any) {
      this.logger.error(`Failed to send customer problem email: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Schedule email to be sent after (supplier response days + 1)
   * This should be called when a problem is reported
   */
  async scheduleCustomerProblemEmail(
    tenantId: string,
    problemId: string,
    customerId: string,
    customerEmail: string,
    customerName: string,
    problemDetails: string,
    supplierId: string,
  ): Promise<void> {
    try {
      // Get supplier to get responseDays
      const supplier = await this.prisma.supplier.findFirst({
        where: {
          id: supplierId,
          tenantId,
        },
      });

      if (!supplier) {
        this.logger.error(`Supplier not found: ${supplierId}`);
        return;
      }

      const responseDays = supplier.responseDays || 3;
      const emailSendDate = new Date();
      emailSendDate.setDate(emailSendDate.getDate() + responseDays + 1);

      // In a real implementation, you would schedule this using a job queue (e.g., Bull, Agenda)
      // For now, we'll just log it. You can integrate with your job system here.
      this.logger.log(
        `Scheduled customer problem email for ${emailSendDate.toISOString()}. ` +
        `Problem: ${problemId}, Customer: ${customerEmail}, Supplier: ${supplier.name}, Response Days: ${responseDays}`
      );

      // TODO: Integrate with job queue to schedule email sending
      // Example:
      // await this.jobQueue.add('send-customer-problem-email', {
      //   tenantId,
      //   problem: {
      //     id: problemId,
      //     customerId,
      //     customerEmail,
      //     customerName,
      //     problemDetails,
      //     supplierId,
      //     supplierName: supplier.name,
      //     supplierResponseDays: responseDays,
      //     reportedAt: new Date(),
      //   },
      // }, {
      //   delay: (responseDays + 1) * 24 * 60 * 60 * 1000, // Delay in milliseconds
      // });
    } catch (error: any) {
      this.logger.error(`Failed to schedule customer problem email: ${error.message}`, error.stack);
      throw error;
    }
  }
}


import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateEmailTemplateDto {
  subject: string;
  subjectAr?: string;
  body: string;
  bodyAr?: string;
  isActive?: boolean;
}

export interface UpdateEmailTemplateDto {
  subject?: string;
  subjectAr?: string;
  body?: string;
  bodyAr?: string;
  isActive?: boolean;
}

@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(private prisma: PrismaService) {}

  async getTemplate(tenantId: string, templateType: string) {
    // For customer-problem, use the existing model for backward compatibility
    if (templateType === 'customer-problem') {
      return this.getCustomerProblemTemplate(tenantId);
    }

    // For other template types, try to find in CustomerProblemEmailTemplate with templateType
    // Note: This is a temporary solution. In production, you should create a generic EmailTemplate model
    try {
      const template = await this.prisma.customerProblemEmailTemplate.findUnique({
        where: { tenantId },
      });

      // If template exists and matches type, return it
      if (template) {
        return {
          ...template,
          templateType: 'customer-problem',
        };
      }
    } catch (error) {
      this.logger.warn(`Template not found for type ${templateType}, returning default`);
    }

    // Return default template based on type
    return this.getDefaultTemplate(tenantId, templateType);
  }

  async createOrUpdateTemplate(
    tenantId: string,
    templateType: string,
    data: CreateEmailTemplateDto | UpdateEmailTemplateDto,
  ) {
    // For customer-problem, use the existing model
    if (templateType === 'customer-problem') {
      return this.createOrUpdateCustomerProblemTemplate(tenantId, data);
    }

    // For other types, store in customer-problem table for now
    // In production, create a generic EmailTemplate model
    const template = await this.prisma.customerProblemEmailTemplate.upsert({
      where: { tenantId },
      update: {
        subject: data.subject || 'Email Update',
        subjectAr: data.subjectAr,
        body: data.body || this.getDefaultEmailBody(),
        bodyAr: data.bodyAr || this.getDefaultEmailBodyAr(),
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
      create: {
        tenantId,
        subject: data.subject || 'Email Update',
        subjectAr: data.subjectAr || 'تحديث البريد الإلكتروني',
        body: data.body || this.getDefaultEmailBody(),
        bodyAr: data.bodyAr || this.getDefaultEmailBodyAr(),
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    this.logger.log(`Email template ${templateType} ${template.id ? 'updated' : 'created'} for tenant ${tenantId}`);
    return {
      ...template,
      templateType,
    };
  }

  async getCustomerProblemTemplate(tenantId: string) {
    const template = await this.prisma.customerProblemEmailTemplate.findUnique({
      where: { tenantId },
    });

    if (!template) {
      // Return default template
      return {
        id: null,
        tenantId,
        templateType: 'customer-problem',
        subject: 'Problem Response Update',
        subjectAr: 'تحديث استجابة المشكلة',
        body: this.getDefaultEmailBody(),
        bodyAr: this.getDefaultEmailBodyAr(),
        isActive: true,
      };
    }

    return {
      ...template,
      templateType: 'customer-problem',
    };
  }

  async createOrUpdateCustomerProblemTemplate(
    tenantId: string,
    data: CreateEmailTemplateDto | UpdateEmailTemplateDto,
  ) {
    const template = await this.prisma.customerProblemEmailTemplate.upsert({
      where: { tenantId },
      update: {
        subject: data.subject,
        subjectAr: data.subjectAr,
        body: data.body,
        bodyAr: data.bodyAr,
        isActive: data.isActive,
      },
      create: {
        tenantId,
        subject: data.subject || 'Problem Response Update',
        subjectAr: data.subjectAr || 'تحديث استجابة المشكلة',
        body: data.body || this.getDefaultEmailBody(),
        bodyAr: data.bodyAr || this.getDefaultEmailBodyAr(),
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    this.logger.log(`Email template ${template.id ? 'updated' : 'created'} for tenant ${tenantId}`);
    return {
      ...template,
      templateType: 'customer-problem',
    };
  }

  private getDefaultTemplate(tenantId: string, templateType: string) {
    const defaults: Record<string, { subject: string; subjectAr: string }> = {
      'order-issue': {
        subject: 'Order Issue Update',
        subjectAr: 'تحديث مشكلة الطلب',
      },
      'delivery-problem': {
        subject: 'Delivery Problem Update',
        subjectAr: 'تحديث مشكلة التوصيل',
      },
      'payment-issue': {
        subject: 'Payment Issue Update',
        subjectAr: 'تحديث مشكلة الدفع',
      },
      'refund-request': {
        subject: 'Refund Request Update',
        subjectAr: 'تحديث طلب الاسترداد',
      },
      'product-quality': {
        subject: 'Product Quality Update',
        subjectAr: 'تحديث جودة المنتج',
      },
      'custom': {
        subject: 'Email Update',
        subjectAr: 'تحديث البريد الإلكتروني',
      },
    };

    const defaultData = defaults[templateType] || defaults['custom'];

    return {
      id: null,
      tenantId,
      templateType,
      subject: defaultData.subject,
      subjectAr: defaultData.subjectAr,
      body: this.getDefaultEmailBody(),
      bodyAr: this.getDefaultEmailBodyAr(),
      isActive: false,
    };
  }

  private getDefaultEmailBody(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #f4f7f9; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 40px 20px; text-align: center; color: white; }
    .content { padding: 40px; }
    .footer { background-color: #f8fafc; padding: 30px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; }
    .logo { max-width: 120px; height: auto; margin-bottom: 15px; border-radius: 8px; }
    h1 { margin: 0; font-size: 24px; font-weight: 700; }
    h2 { color: #1e293b; font-size: 20px; margin-top: 0; }
    p { margin-bottom: 16px; color: #334155; }
    .details-box { background-color: #f1f5f9; padding: 20px; border-radius: 8px; border-left: 4px solid #6366f1; margin: 25px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      {{#if storeLogo}}
        <img src="{{storeLogo}}" alt="{{storeName}}" class="logo" />
      {{/if}}
      <h1>{{storeName}}</h1>
    </div>
    <div class="content">
      <h2>Problem Response Update</h2>
      <p>Dear {{customerName}},</p>
      <p>We wanted to inform you that we have received your problem report and are working with our supplier to resolve it as quickly as possible.</p>
      <p>Our supplier typically responds within <strong>{{supplierResponseDays}} days</strong>. We will update you immediately once we receive a response.</p>
      
      <div class="details-box">
        <p style="margin-bottom: 8px; font-weight: 600; color: #475569;">Problem Details:</p>
        <p style="margin-bottom: 0; font-style: italic;">{{problemDetails}}</p>
      </div>
      
      <p>Thank you for your patience and for choosing {{storeName}}.</p>
      <p>Best regards,<br><strong>{{storeName}} Team</strong></p>
    </div>
    <div class="footer">
      <p style="margin-bottom: 10px;">{{storeDetails}}</p>
      <p>&copy; {{currentYear}} {{storeName}}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  private getDefaultEmailBodyAr(): string {
    return `
<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.8; color: #1a1a1a; background-color: #f4f7f9; margin: 0; padding: 0; text-align: right; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 40px 20px; text-align: center; color: white; }
    .content { padding: 40px; }
    .footer { background-color: #f8fafc; padding: 30px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; }
    .logo { max-width: 120px; height: auto; margin-bottom: 15px; border-radius: 8px; }
    h1 { margin: 0; font-size: 24px; font-weight: 700; }
    h2 { color: #1e293b; font-size: 20px; margin-top: 0; }
    p { margin-bottom: 16px; color: #334155; }
    .details-box { background-color: #f1f5f9; padding: 20px; border-radius: 8px; border-right: 4px solid #6366f1; margin: 25px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      {{#if storeLogo}}
        <img src="{{storeLogo}}" alt="{{storeName}}" class="logo" />
      {{/if}}
      <h1>{{storeName}}</h1>
    </div>
    <div class="content">
      <h2>تحديث استجابة المشكلة</h2>
      <p>عزيزي/عزيزتي {{customerName}}،</p>
      <p>نود إعلامك بأننا قد تلقينا تقرير المشكلة الخاص بك ونعمل حالياً مع المورد لدينا لحلها في أقرب وقت ممكن.</p>
      <p>عادة ما يستجيب موردنا خلال <strong>{{supplierResponseDays}} أيام</strong>. سنقوم بتزويدك بالتحديثات فور استلامنا الرد.</p>
      
      <div class="details-box">
        <p style="margin-bottom: 8px; font-weight: 600; color: #475569;">تفاصيل المشكلة:</p>
        <p style="margin-bottom: 0; font-style: italic;">{{problemDetails}}</p>
      </div>
      
      <p>نشكرك على صبرك وعلى اختيارك لـ {{storeName}}.</p>
      <p>مع أطيب التحيات،<br><strong>فريق {{storeName}}</strong></p>
    </div>
    <div class="footer">
      <p style="margin-bottom: 10px;">{{storeDetails}}</p>
      <p>&copy; {{currentYear}} {{storeName}}. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  async renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): Promise<string> {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      rendered = rendered.replace(regex, value || '');
    }
    return rendered;
  }
}


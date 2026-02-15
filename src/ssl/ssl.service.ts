// apps/app-core/src/ssl/ssl.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SslService {
  private readonly logger = new Logger(SslService.name);

  constructor(private prisma: PrismaService) {}

  async provisionCertificate(domainId: string) {
    const domain = await this.prisma.customDomain.findUnique({
      where: { id: domainId },
      include: { tenant: true },
    });

    if (!domain) {
      throw new Error('Domain not found');
    }

    // Integration with Let's Encrypt or Cloudflare would go here
    // For now, simulate certificate generation
    
    try {
      const certificate = await this.prisma.sslCertificate.create({
        data: {
          domainId,
          issuer: "Let's Encrypt",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
          autoRenew: true,
        },
      });

      await this.prisma.customDomain.update({
        where: { id: domainId },
        data: { sslStatus: 'ACTIVE' },
      });

      this.logger.log(`SSL certificate provisioned for ${domain.domain}`);
      return certificate;
    } catch (error) {
      this.logger.error(`SSL provisioning failed: ${error}`);
      throw error;
    }
  }

  async checkRenewal() {
    const expiringSoon = await this.prisma.sslCertificate.findMany({
      where: {
        expiresAt: {
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
        autoRenew: true,
      },
      include: { domain: true },
    });

    for (const cert of expiringSoon) {
      await this.renewCertificate(cert.id);
    }
  }

  private async renewCertificate(certificateId: string) {
    // Certificate renewal logic
    this.logger.log(`Renewing certificate: ${certificateId}`);
  }
}
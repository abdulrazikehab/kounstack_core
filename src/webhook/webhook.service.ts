import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { validateOutboundUrl } from '../security/url-safety';
import { safeStringify } from '../security/log-redaction';

@Injectable()
export class WebhookService {
  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async dispatch(event: string, payload: any, tenantId: string) {
    // Fetch active endpoints for this tenant that subscribe to the event
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        tenantId,
        isActive: true,
        events: { has: event },
      },
    });

    const results: { endpointId: string; success: boolean; error?: unknown }[] = [];
    for (const endpoint of endpoints) {
      try {
        // SSRF Protection: Validate URL before use
        await validateOutboundUrl(endpoint.url);

        // Create delivery record
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            endpointId: endpoint.id,
            event,
            payload: safeStringify(payload), // Store stringified payload securely
            attempts: 1,
          },
        });

        // Send request
        const response: any = await this.http.post(endpoint.url, {
          id: delivery.id,
          event,
          createdAt: new Date().toISOString(),
          payload,
        }, {
          headers: {
            'X-Webhook-Secret': endpoint.secret,
          },
          timeout: 5000,
          maxContentLength: 10000, // Limit response size
        }).toPromise().catch(err => {
            // Return error response structure if axios fails
            if (err.response) return err.response;
            throw err;
        });

        // Update delivery status
        const responseBodyStr = safeStringify(response.data || response, 1024); // Truncate response body
        
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            responseCode: response.status || 500, // Ensure status code is integer
            responseBody: responseBodyStr,
            deliveredAt: new Date(),
          },
        });
        results.push({ endpointId: endpoint.id, success: response.status >= 200 && response.status < 300 });
      } catch (error: any) {
        // Log failure
        console.error(`Webhook failed for ${endpoint.url}:`, error.message || error);
        results.push({ endpointId: endpoint.id, success: false, error: error.message || String(error) });
      }
    }
    return results;
  }
}

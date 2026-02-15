import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  Param,
  UseGuards,
  BadRequestException,
  Logger,
  Res,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CustomerInventoryService } from './customer-inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from '../types/request.types';
import { Public } from '../auth/public.decorator';

@Controller('customer/inventory')
@UseGuards(JwtAuthGuard)
export class CustomerInventoryController {
  private readonly logger = new Logger(CustomerInventoryController.name);
  
  constructor(
    private readonly customerInventoryService: CustomerInventoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('debug-dump')
  async debugDump(@Request() req: any) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const email = req.user?.email;
    const userId = req.user?.sub || req.user?.userId;

    this.logger.log(`🔍 DEBUG DUMP for user: ${email} (${userId}), tenant: ${tenantId}`);

    const tenants = await this.prisma.tenant.findMany({
        select: { id: true, subdomain: true, name: true }
    });

    const inventoryCount = await this.prisma.cardInventory.count({
        where: { tenantId }
    });

    const userCards = await this.prisma.cardInventory.findMany({
        where: { OR: [{ soldToUserId: userId }, { soldToUser: { email } }] },
        include: { product: { select: { name: true } } },
        take: 50
    });

    const recentOrders = await this.prisma.order.findMany({
        where: { OR: [{ customerEmail: email }, { guestEmail: email }] },
        take: 10,
        orderBy: { createdAt: 'desc' }
    });

    return {
        context: { tenantId, email, userId },
        tenants,
        currentTenantInventoryCount: inventoryCount,
        userCards,
        recentOrders: recentOrders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            customerEmail: o.customerEmail,
            hasDeliveryFiles: !!o.deliveryFiles,
            tenantId: o.tenantId
        }))
    };
  }

  @Get()
  async getInventory(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.id || (req.user as any)?.userId;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    // SECURITY FIX: Always prioritize site context (req.tenantId) for customers 
    // to ensure they see inventory for the store they are currently visiting.
    // This allows users registered on one store to see their purchases on another.
    const tenantId = req.tenantId || req.user?.tenantId;
    
    if (!userId) throw new BadRequestException('User not authenticated');
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    return this.customerInventoryService.getCustomerInventory(
      tenantId, 
      userId,
      userRole,
      (req.user as any)?.permissions || [],
      userEmail
    );
  }

  @Post('sync-from-order/:orderId')
  async syncFromOrder(
    @Request() req: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');

    const tenantId = req.user?.tenantId || req.tenantId;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, deliveryFiles: true, tenantId: true },
    });

    if (!order) throw new BadRequestException('Order not found');
    
    const df = order.deliveryFiles as any;
    const serials: any[] = [];
    if (df?.serialNumbersByProduct) {
        Object.entries(df.serialNumbersByProduct).forEach(([productName, list]: [string, any]) => {
            if (Array.isArray(list)) {
                list.forEach(it => {
                    serials.push({ productName, serialNumber: it.serialNumber || it.cardCode, pin: it.pin || it.cardPin });
                });
            }
        });
    }

    if (serials.length === 0) throw new BadRequestException('No serials found in this order');

    await this.customerInventoryService.saveCardsFromOrder(order.tenantId, userId, order.id, serials);

    return { success: true, count: serials.length };
  }

  @Post('download')
  async downloadInventory(
    @Request() req: AuthenticatedRequest,
    @Body() body: { ids: string[]; format: 'text' | 'excel' | 'pdf' },
    @Res() res: Response,
  ) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || req.tenantId;
    
    const result = await this.customerInventoryService.downloadInventory(tenantId, userId, body.ids, body.format, req.user?.email);
    
    if (!fs.existsSync(result.filePath)) throw new BadRequestException('File not found');

    const contentTypes: any = {
      pdf: 'application/pdf',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      text: 'text/plain'
    };

    res.setHeader('Content-Type', contentTypes[body.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    
    fs.createReadStream(result.filePath).pipe(res);
  }

  @Post('send-email')
  async sendEmail(@Request() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.customerInventoryService.sendToEmail(tenantId, userId, body.ids, req.user?.email);
  }

  @Post('resend-order-email/:orderId')
  async resendOrderEmail(@Request() req: AuthenticatedRequest, @Param('orderId') orderId: string) {
    const userId = req.user?.id || (req.user as any)?.userId;
    const tenantId = req.tenantId || req.user?.tenantId;
    return this.customerInventoryService.resendOrderEmail(tenantId, userId, orderId, req.user?.email);
  }

  @Post('send-whatsapp')
  async sendWhatsApp(@Request() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.customerInventoryService.sendToWhatsApp(tenantId, userId, body.ids, req.user?.email);
  }

  @Post('use')
  async useCards(@Request() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.customerInventoryService.markAsUsed(tenantId, userId, body.ids, req.user?.email);
  }

  @Post('remove')
  async removeCards(@Request() req: AuthenticatedRequest, @Body() body: { ids: string[] }) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.customerInventoryService.removeCards(tenantId, userId, body.ids, req.user?.email);
  }

  @Post('reveal/:id')
  async revealCard(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const userId = req.user?.id || (req.user as any)?.userId;
    const tenantId = req.tenantId || req.user?.tenantId;
    
    if (!userId) throw new BadRequestException('User not authenticated');
    
    return this.customerInventoryService.revealCard(tenantId, userId, id, req.user?.email);
  }

  @Public()
  @Get('test-email-connection')
  async testEmailConnection(@Request() req: any, @Query('email') email: string) {
    const tenantId = req.tenantId || req.user?.tenantId;
    return this.customerInventoryService.testEmailConnection(tenantId, email);
  }
}

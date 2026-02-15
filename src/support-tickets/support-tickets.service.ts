import { Injectable, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UserService } from '../user/user.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly notificationsService: NotificationsService
  ) {}

  async create(tenantId: string, userId: string, createTicketDto: CreateTicketDto, userData?: { email: string, role: string }) {
    // Validate Tenant existence
    const tenantExists = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenantExists) {
      console.error(`[SupportTicketsService] Tenant ID ${tenantId} not found`);
      throw new BadRequestException(`Tenant not found (ID: ${tenantId}). Please refresh the page.`);
    }

    // Ensure user exists in core database (sync from auth database)
    const user = await this.userService.ensureUserExists(userId, {
        email: userData?.email || `user-${userId}@temp.local`,
        role: userData?.role || 'SHOP_OWNER',
        tenantId: tenantId
    });

    if (!user) {
        console.error(`[SupportTicketsService] Failed to ensure user exists for ID ${userId}`);
        throw new BadRequestException(`User account not found (ID: ${userId}). Please log out and log back in.`);
    }

    // Find the last ticket number to generate the next sequential one
    const lastTicket = await this.prisma.supportTicket.findFirst({
      where: { tenantId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true }
    });

    let nextNum = 1;
    if (lastTicket && lastTicket.ticketNumber) {
      // Extract number part assuming format TKT-000000
      const match = lastTicket.ticketNumber.match(/TKT-(\d+)/);
      if (match && match[1]) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }

    const ticketNumber = `TKT-${String(nextNum).padStart(6, '0')}`;

    try {
        // If orderId is provided, verify it exists and belongs to this user/tenant
        if (createTicketDto.orderId) {
            const orderExists = await this.prisma.order.findUnique({
                where: { id: createTicketDto.orderId }
            });
            if (!orderExists) {
                // Not strictly required for FK since it's just a string, but good for data integrity
                console.warn(`[SupportTicketsService] Order ID ${createTicketDto.orderId} provided but not found`);
            }
        }

        return await this.prisma.supportTicket.create({
          data: {
            tenantId,
            userId: user.id, // Use the ID from the synced user object
            ticketNumber,
            title: createTicketDto.title,
            description: createTicketDto.description,
            orderId: createTicketDto.orderId || null, 
            priority: createTicketDto.priority || 'MEDIUM',
            status: 'OPEN',
          },
        });
    } catch (e: any) {
        if (e.code === 'P2002') {
             throw new ConflictException('A ticket with this number already exists. Please try again.');
        }
        if (e.code === 'P2003') {
             // Foreign key constraint failed (User or Tenant)
             throw new BadRequestException('Invalid User ID or Tenant ID. Your session may be stale.');
        }
        throw new InternalServerErrorException(`Failed to create ticket: ${e.message}`);
    }
  }

  async findAll(tenantId: string, userId: string, userData?: { email: string, role: string }) {
    // Ensure user exists and get local ID
    const user = await this.userService.ensureUserExists(userId, {
        email: userData?.email || `user-${userId}@temp.local`,
        role: userData?.role || 'SHOP_OWNER',
        tenantId: tenantId
    });

    // Determine if user should see all tickets in tenant (Merchants, Staff, Admins)
    const canSeeAll = user.role === 'SUPER_ADMIN' || user.role === 'SHOP_OWNER' || user.role === 'STAFF';

    return this.prisma.supportTicket.findMany({
      where: {
        tenantId,
        ...(canSeeAll ? {} : { userId: user.id }),
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        replies: true, 
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });
  }

  async findOne(tenantId: string, userId: string, ticketId: string, userData?: { email: string, role: string }) {
    // Ensure user exists and get local ID
    const user = await this.userService.ensureUserExists(userId, {
        email: userData?.email || `user-${userId}@temp.local`,
        role: userData?.role || 'SHOP_OWNER',
        tenantId: tenantId
    });

    // Determine if user should see all tickets in tenant
    const canSeeAll = user.role === 'SUPER_ADMIN' || user.role === 'SHOP_OWNER' || user.role === 'STAFF';

    const ticket = await this.prisma.supportTicket.findFirst({
        where: {
            id: ticketId,
            tenantId,
            ...(canSeeAll ? {} : { userId: user.id }),
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true
                }
            },
            replies: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            role: true,
                            avatar: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                }
            }
        }
    });

    if (!ticket) {
        throw new NotFoundException('Support ticket not found');
    }

    return ticket;
  }

  async addReply(tenantId: string, userId: string, ticketId: string, message: string, userData?: { email: string, role: string }) {
    // Ensure user exists
    const user = await this.userService.ensureUserExists(userId, {
        email: userData?.email || `user-${userId}@temp.local`,
        role: userData?.role || 'SHOP_OWNER',
        tenantId: tenantId
    });

    // Check if ticket exists
    const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId }
    });

    if (!ticket || ticket.tenantId !== tenantId) {
        throw new NotFoundException('Ticket not found');
    }

    // Check if user has access (author or staff/merchant)
    const isStaffRole = user.role === 'SUPER_ADMIN' || user.role === 'SHOP_OWNER' || user.role === 'STAFF';
    const canAccess = isStaffRole || ticket.userId === user.id;

    if (!canAccess) {
        throw new BadRequestException('You do not have permission to reply to this ticket');
    }

    // Prevent replying to closed tickets
    if (ticket.status === 'CLOSED') {
        throw new BadRequestException('Cannot reply to a closed ticket');
    }

    // Create the reply
    const reply = await this.prisma.ticketReply.create({
        data: {
            ticketId,
            userId: user.id,
            message,
            isStaffReply: isStaffRole
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    role: true,
                    avatar: true
                }
            }
        }
    });

    // Update ticket status to IN_PROGRESS if it was OPEN/PENDING
    if (ticket.status === 'OPEN' || ticket.status === 'PENDING') {
        await this.prisma.supportTicket.update({
            where: { id: ticketId },
            data: { status: 'IN_PROGRESS' }
        });
    }

    // Notify customer if it's a staff reply
    if (reply.isStaffReply) {
        try {
            const customer = await this.prisma.user.findUnique({
                where: { id: ticket.userId }
            });

            if (customer) {
                const titleAr = `تم الرد على تذكرة الدعم الخاصة بك: ${ticket.title}`;
                const titleEn = `Reply received for your support ticket: ${ticket.title}`;
                const bodyAr = `وصلك رد جديد على التذكرة #${ticket.ticketNumber}:\n\n${message}`;
                const bodyEn = `You got a new reply for ticket #${ticket.ticketNumber}:\n\n${message}`;

                // 1. In-app notification
                await this.notificationsService.create({
                    tenantId,
                    userId: customer.id,
                    type: 'CUSTOMER',
                    titleEn,
                    titleAr,
                    bodyEn,
                    bodyAr,
                    data: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber }
                });

                // 2. Email notification
                if (customer.email) {
                    const tenant = await this.prisma.tenant.findUnique({
                        where: { id: tenantId },
                        select: { name: true }
                    });

                    await this.notificationsService.sendEmailDirect({
                        to: customer.email,
                        subject: titleAr,
                        body: bodyAr,
                        tenantId,
                        fromName: tenant?.name
                    });
                }

                // 3. SMS notification
                if (customer.phone) {
                    await this.notificationsService.sendSMS({
                        to: customer.phone,
                        message: bodyAr,
                        tenantId
                    });
                }

                // 4. WhatsApp notification
                if (customer.phone) {
                    await this.notificationsService.sendWhatsApp({
                        to: customer.phone,
                        message: bodyAr,
                        tenantId
                    });
                }
            }
        } catch (error) {
            console.error('Failed to send notification for ticket reply', error);
        }
    }

    return reply;
  }

  async close(tenantId: string, userId: string, ticketId: string, documentation: string, userData?: { email: string, role: string }) {
    // Ensure user exists
    const user = await this.userService.ensureUserExists(userId, {
        email: userData?.email || `user-${userId}@temp.local`,
        role: userData?.role || 'SHOP_OWNER',
        tenantId: tenantId
    });

    // Check if ticket exists
    const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { user: true }
    });

    if (!ticket || ticket.tenantId !== tenantId) {
        throw new NotFoundException('Ticket not found');
    }

    // Only staff/merchants can close with documentation
    const isStaffRole = user.role === 'SUPER_ADMIN' || user.role === 'SHOP_OWNER' || user.role === 'STAFF';
    if (!isStaffRole) {
        throw new BadRequestException('Only staff or store owners can close tickets with documentation');
    }

    // Update ticket status
    const updatedTicket = await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
            status: 'CLOSED',
            closedAt: new Date(),
            resolvedAt: new Date()
        }
    });

    // Add documentation as a reply
    await this.prisma.ticketReply.create({
        data: {
            ticketId,
            userId: user.id,
            message: `التوثيق (سبب الإغلاق):\n${documentation}`,
            isStaffReply: true
        }
    });

    // Send notifications to the STORE OWNER (not the customer)
    try {
        const storeOwner = await this.prisma.user.findFirst({
            where: { 
                tenantId,
                role: 'SHOP_OWNER'
            }
        });

        if (storeOwner) {
            const titleAr = `تم إغلاق تذكرة دعم وتوثيقها: ${ticket.title}`;
            const titleEn = `Support ticket closed and documented: ${ticket.title}`;
            const bodyAr = `قام الموظف بإغلاق التذكرة #${ticket.ticketNumber}.\n\nالتوثيق:\n${documentation}\n\nجهة العميل: ${ticket.user?.name || ticket.user?.email}`;
            const bodyEn = `A staff member closed ticket #${ticket.ticketNumber}.\n\nDocumentation:\n${documentation}\n\nCustomer: ${ticket.user?.name || ticket.user?.email}`;

            // 1. In-app notification to Owner
            await this.notificationsService.create({
                tenantId,
                userId: storeOwner.id,
                type: 'CUSTOMER', // Using CUSTOMER type or we could use STAFF/ADMIN if available
                titleEn,
                titleAr,
                bodyEn,
                bodyAr,
                data: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber }
            });

            // 2. Email notification to Owner
            if (storeOwner.email) {
                const tenant = await this.prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { name: true }
                });

                await this.notificationsService.sendEmailDirect({
                    to: storeOwner.email,
                    subject: titleAr,
                    body: bodyAr,
                    tenantId,
                    fromName: tenant?.name
                });
            }

            // 3. SMS notification to Owner
            if (storeOwner.phone) {
                await this.notificationsService.sendSMS({
                    to: storeOwner.phone,
                    message: bodyAr,
                    tenantId
                });
            }

            // 4. WhatsApp notification to Owner
            if (storeOwner.phone) {
                await this.notificationsService.sendWhatsApp({
                    to: storeOwner.phone,
                    message: bodyAr,
                    tenantId
                });
            }
        }
    } catch (error) {
        console.error('Failed to send notification for ticket closure', error);
    }

    return updatedTicket;
  }
}

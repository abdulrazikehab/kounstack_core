import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SendMessageDto {
  tenantId: string;
  senderId: string;
  content: string;
}

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async send(dto: SendMessageDto) {
    return this.prisma.chatMessage.create({
      data: {
        tenantId: dto.tenantId,
        senderId: dto.senderId,
        content: dto.content,
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
      },
    });
  }

  async recent(tenantId: string, take = 100) {
    return this.prisma.chatMessage.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' }, // Changed to 'asc' for chronological order
      take,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
      },
    });
  }

  async getConversation(tenantId: string, userId1: string, userId2: string, take = 50) {
    return this.prisma.chatMessage.findMany({
      where: {
        tenantId,
        OR: [
          { senderId: userId1 },
          { senderId: userId2 },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
      },
    });
  }
}

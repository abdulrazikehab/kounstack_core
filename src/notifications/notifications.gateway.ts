import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { 
    origin: [
      'https://kounworld.com', 'https://saeaa.net',
      'https://www.kounworld.com', 'https://www.saeaa.net',
      'https://app.kounworld.com', 'https://app.saeaa.net',
      'https://kawn.com', 'https://kawn.net',
      'http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'http://localhost:8080'
    ],
    credentials: true
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      
      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secret',
      });

      (client as any).user = payload;
      
      // Join a room for the specific user
      client.join(`user_${payload.id || payload.sub}`);
      
      // Join a room for the specific tenant (for broadcast to all merchant staff)
      if (payload.tenantId) {
        client.join(`tenant_${payload.tenantId}`);
      }

      this.logger.log(`Client ${client.id} connected (User: ${payload.id || payload.sub}, Tenant: ${payload.tenantId})`);
    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}: ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  sendToTenant(tenantId: string, event: string, data: any) {
    this.server.to(`tenant_${tenantId}`).emit(event, data);
  }
}

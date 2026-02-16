import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';

@WebSocketGateway({ 
  namespace: '/chat', 
  cors: { 
    origin: [
      'https://kounworld.com', 'https://saeaa.net',
      'https://www.kounworld.com', 'https://www.saeaa.net',
      'https://app.kounworld.com', 'https://app.saeaa.net',
      'https://kawn.com', 'https://kawn.net',
      'http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'http://localhost:8080'
    ],
    credentials: true
  } 
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  // Authenticate on connection
  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) {
        client.disconnect();
        return;
    }
    try {
      const payload = this.jwt.verify(token);
      (client as any).user = payload; // attach user data
      client.join(payload.tenantId);   // room per tenant
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('message')
  async onMessage(
    @MessageBody('content') content: string,
    @ConnectedSocket() client: Socket,
  ) {
    const user = (client as any).user;
    if (!user) return;
    
    const saved = await this.chat.send({
      tenantId: user.tenantId,
      senderId: user.sub,
      content,
    });

    // Emit the complete message with sender information
    this.server
      .to(user.tenantId)
      .emit('message', {
        id: saved.id,
        senderId: saved.senderId,
        content: saved.content,
        createdAt: saved.createdAt,
        sender: saved.sender,
      });
  }
}

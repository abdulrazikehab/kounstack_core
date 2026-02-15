import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RedisService } from './redis.service';

@Controller('redis-test')
export class RedisTestController {
  constructor(private readonly redisService: RedisService) {}

  @Get('health')
  async healthCheck() {
    const isHealthy = await this.redisService.healthCheck();
    return { status: isHealthy ? 'ok' : 'error', redisAvailable: isHealthy };
  }

  @Post('set')
  async setKey(@Body() body: { key: string; value: any; ttl?: number }) {
    await this.redisService.set(body.key, body.value, body.ttl);
    return { success: true, key: body.key, value: body.value };
  }

  @Get('get/:key')
  async getKey(@Param('key') key: string) {
    const value = await this.redisService.get(key);
    return { key, value };
  }
}

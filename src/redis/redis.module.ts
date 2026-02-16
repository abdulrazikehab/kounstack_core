import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { RedisTestController } from './redis-test.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RedisTestController],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        // Redis temporarily disabled: always return null client.
        // This keeps RedisService injectable but makes all operations no-ops.
        console.warn('⚠️ Redis is disabled. Skipping Redis client initialization.');
        return null;
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
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
        const redisPassword = configService.get('REDIS_PASSWORD');
        const redisHost = configService.get('REDIS_HOST') || 'localhost';
        const redisPort = configService.get('REDIS_PORT') || 6379;
        
        const redisConfig: any = {
          host: redisHost,
          port: redisPort,
          db: configService.get('REDIS_DB') || 0,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            // Stop retrying after 3 attempts
            if (times > 3) {
              console.warn('⚠️ Redis retry limit reached. Continuing without Redis.');
              return null;
            }
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        };

        // Only add authentication if password is provided
        if (redisPassword) {
          redisConfig.username = configService.get('REDIS_USERNAME') || 'default';
          redisConfig.password = redisPassword;
          console.log(`🔐 Redis authentication configured for ${redisHost}:${redisPort}`);
        } else {
          console.warn('⚠️ REDIS_PASSWORD not set. Attempting to connect without authentication.');
        }

        try {
          const redisClient = new Redis(redisConfig);

          redisClient.on('connect', () => {
            console.log('✅ Redis connected successfully');
          });

          redisClient.on('error', (err) => {
            // Handle NOAUTH error specifically
            if (err.message.includes('NOAUTH')) {
              console.error('❌ Redis requires authentication but no password was provided.');
              console.warn('💡 Please set REDIS_PASSWORD in your .env file or disable Redis authentication.');
              console.warn('⚠️ Continuing without Redis. Cart and caching functionality will be limited.');
            } else {
              console.error('❌ Redis Client Error:', err.message);
            }
          });

          redisClient.on('ready', () => {
            console.log('🚀 Redis client ready');
          });

          // Try to connect with timeout
          try {
            await Promise.race([
              redisClient.connect(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 3000)
              )
            ]);
            
            // Test the connection with a ping
            await redisClient.ping();
            console.log('✅ Redis connection verified');
            return redisClient;
          } catch (connectError: any) {
            if (connectError.message.includes('NOAUTH')) {
              console.error('❌ Redis authentication failed: NOAUTH');
              console.warn('💡 Set REDIS_PASSWORD environment variable or disable Redis authentication');
            } else {
              console.error('❌ Failed to connect to Redis:', connectError.message);
            }
            console.warn('⚠️ Continuing without Redis. Cart and caching functionality will be limited.');
            
            // Disconnect the client to prevent further errors
            try {
              await redisClient.quit();
            } catch (e) {
              // Ignore quit errors
            }
            
            return null;
          }
        } catch (error: any) {
          console.error('❌ Redis initialization failed:', error.message);
          console.warn('⚠️ Continuing without Redis. Cart and caching functionality will be limited.');
          return null;
        }
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}
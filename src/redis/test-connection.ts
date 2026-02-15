// apps/app-core/src/redis/test-connection.ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

async function testRedisConnection() {
  console.log('🔍 Testing Redis connection...');
  
  // Initialize ConfigService
  const configModule = await ConfigModule.forRoot({
    envFilePath: '.env',
  });
  const configService = new ConfigService();
  
  const redisConfig = {
    host: configService.get('REDIS_HOST') || 'localhost',
    port: configService.get('REDIS_PORT') || 6379,
    username: configService.get('REDIS_USERNAME'),
    password: configService.get('REDIS_PASSWORD'),
    db: configService.get('REDIS_DB') || 0,
    // Add connection options to prevent hanging
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 1,
  };

  console.log('🔧 Redis config:', { ...redisConfig, password: '***' });

  const redisClient = new Redis(redisConfig);

  // Add event listeners for debugging
  redisClient.on('connect', () => {
    console.log('🟡 Redis connecting...');
  });

  redisClient.on('ready', () => {
    console.log('✅ Redis connected and ready');
  });

  redisClient.on('error', (error) => {
    console.error('❌ Redis connection error:', error);
  });

  try {
    // Test if Redis is responsive
    await redisClient.ping();
    console.log('✅ Redis ping successful');

    // Test set/get operations
    await redisClient.set('test-key', 'Hello Redis!', 'EX', 10); // Expire in 10 seconds
    const result = await redisClient.get('test-key');
    console.log('✅ Test get/set:', result);

    // Test connection info
    const info = await redisClient.info();
    console.log('✅ Redis info received - server is running');

    await redisClient.quit();
    console.log('✅ Redis connection test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Redis test failed:', error);
    process.exit(1);
  }
}

// Run the test
testRedisConnection();
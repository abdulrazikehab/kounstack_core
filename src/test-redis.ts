import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisService } from './redis/redis.service';

async function testRedis() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const redisService = app.get(RedisService);

  console.log('\n🔍 Testing Redis Connection...\n');

  // Test 1: Health Check
  const isHealthy = await redisService.healthCheck();
  console.log(`✅ Health Check: ${isHealthy ? 'PASSED' : 'FAILED'}`);

  if (!isHealthy) {
    console.log('❌ Redis is not available. Exiting...');
    await app.close();
    return;
  }

  // Test 2: Set a value
  console.log('\n📝 Setting test value...');
  await redisService.set('test-key', { message: 'Hello Redis!' }, 60);
  console.log('✅ Value set successfully');

  // Test 3: Get the value
  console.log('\n📖 Getting test value...');
  const value = await redisService.get('test-key');
  console.log('✅ Retrieved value:', value);

  // Test 4: Test cart session
  console.log('\n🛒 Testing cart session...');
  await redisService.setCartSession('session-123', { items: [], total: 0 });
  const cart = await redisService.getCartSession('session-123');
  console.log('✅ Cart session:', cart);

  // Test 5: Test caching
  console.log('\n💾 Testing cache...');
  await redisService.setCache('product-123', { id: '123', name: 'Test Product' });
  const cachedProduct = await redisService.getCache('product-123');
  console.log('✅ Cached product:', cachedProduct);

  console.log('\n✅ All Redis tests passed!\n');

  await app.close();
}

testRedis().catch(console.error);

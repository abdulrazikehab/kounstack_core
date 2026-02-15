// scripts/test-cloudinary.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CloudinaryService } from './cloudinary.service';
import * as fs from 'fs';
import * as path from 'path';

async function testCloudinary() {
  console.log('🔧 Testing Cloudinary Configuration...\n');

  const app = await NestFactory.createApplicationContext(AppModule);
  const cloudinaryService = app.get(CloudinaryService);

  try {
    // Test 1: Check connection
    console.log('1. Testing Cloudinary connection...');
    const isConnected = await cloudinaryService.testConnection();
    if (isConnected) {
      console.log('✅ Cloudinary connection successful\n');
    } else {
      console.log('❌ Cloudinary connection failed\n');
      return;
    }

    // Test 2: Create a test image buffer (small red dot)
    console.log('2. Creating test image...');
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );

    const testFile: Express.Multer.File = {
      fieldname: 'test',
      originalname: 'test.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: testImageBuffer,
      size: testImageBuffer.length,
    } as any;

    // Test 3: Upload test image
    console.log('3. Uploading test image to Cloudinary...');
    const uploadResult = await cloudinaryService.uploadImage(testFile, 'test-uploads');
    console.log('✅ Upload successful!');
    console.log('   Public ID:', uploadResult.publicId);
    console.log('   URL:', uploadResult.secureUrl);
    console.log('   Size:', uploadResult.bytes, 'bytes\n');

    // Test 4: Generate optimized URLs
    console.log('4. Testing URL generation...');
    const optimizedUrl = cloudinaryService.generateOptimizedUrl(uploadResult.publicId);
    const thumbnailUrl = cloudinaryService.generateThumbnailUrl(uploadResult.publicId);
    console.log('   Optimized URL:', optimizedUrl);
    console.log('   Thumbnail URL:', thumbnailUrl);
    console.log('');

    // Test 5: Delete test image
    console.log('5. Testing image deletion...');
    await cloudinaryService.deleteImage(uploadResult.publicId);
    console.log('✅ Image deleted successfully\n');

    console.log('🎉 All Cloudinary tests passed!');
    
  } catch (error) {
    console.error('❌ Cloudinary test failed:', error);
  } finally {
    await app.close();
  }
}

testCloudinary();
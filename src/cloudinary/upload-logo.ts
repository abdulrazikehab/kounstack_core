// Standalone script to upload Saeaa logo to Cloudinary
import * as cloudinary from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from multiple possible .env locations
const possibleEnvPaths = [
  path.join(__dirname, '../../../../../.env'), // Root Backend/.env
  path.join(__dirname, '../../../../.env'), // Alternative path
  path.join(process.cwd(), '.env'), // Current working directory
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`📄 Loaded .env from: ${envPath}`);
    break;
  }
}

// Also try loading from process.env directly (if already loaded)
dotenv.config();

const v2 = cloudinary.v2;

// Configure Cloudinary from environment variables
v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadLogo() {
  console.log('🖼️  Uploading Saeaa Logo to Cloudinary...\n');

  // Validate configuration
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ Cloudinary credentials not found in .env file');
    console.error('   Please ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set\n');
    process.exit(1);
  }

  // Path to logo file
  const logoPath = path.join(__dirname, '../../../frontend/public/branding/koun-logo.png');

  console.log(`📁 Reading logo file from: ${logoPath}...`);
  
  if (!fs.existsSync(logoPath)) {
    console.error(`❌ Logo file not found at ${logoPath}`);
    console.error('   Please ensure the logo file exists at Frontend/public/branding/kawn-logo.png\n');
    process.exit(1);
  }

  try {
    // Upload to Cloudinary
    console.log('📤 Uploading logo to Cloudinary...\n');
    
    const result = await v2.uploader.upload(logoPath, {
      folder: 'branding',
      public_id: 'saeaa-logo',
      overwrite: true, // Overwrite if exists
      resource_type: 'image',
      transformation: [
        { quality: 'auto', fetch_format: 'auto' }
      ]
    });

    console.log('✅ Logo uploaded successfully!\n');
    console.log('📋 Upload Details:');
    console.log('   Public ID:', result.public_id);
    console.log('   Secure URL:', result.secure_url);
    console.log('   URL:', result.url);
    console.log('   Format:', result.format);
    console.log('   Dimensions:', result.width, 'x', result.height);
    console.log('   File size:', result.bytes, 'bytes\n');

    // Generate optimized URL for email (smaller, faster loading)
    const optimizedUrl = v2.url(result.public_id, {
      width: 300,
      quality: 'auto',
      fetch_format: 'auto',
      crop: 'limit',
      secure: true,
    });

    console.log('📧 Optimized URL for emails (300px width):');
    console.log('   ', optimizedUrl);
    console.log('\n');

    console.log('📝 Next steps:');
    console.log('   1. Copy the Secure URL or Optimized URL above');
    console.log('   2. Add it to your .env file in Backend/apps/app-auth:');
    console.log(`      EMAIL_LOGO_URL=${result.secure_url}`);
    console.log('   3. Or use the optimized URL for faster email loading:');
    console.log(`      EMAIL_LOGO_URL=${optimizedUrl}`);
    console.log('   4. Restart your auth service\n');

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error uploading logo:', error.message);
    if (error.http_code) {
      console.error(`   HTTP Code: ${error.http_code}`);
    }
    process.exit(1);
  }
}

uploadLogo();


// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MerchantAuthController } from './merchant-auth.controller';
import { OAuthController } from './oauth.controller';
import { KycController } from '../kyc/kyc.controller';
import { CustomersController } from '../customers/customers.controller';
import { JwtStrategy } from '../guard/jwt.strategy';
// import { GoogleOAuthStrategy } from '../strategies/google-oauth.strategy'; // ⚠️ COMMENTED OUT: Uncomment when Google OAuth env vars are configured
import { JwtAuthGuard } from '../guard/jwt-auth.guard';
import { PaymentLimitsGuard } from '../guard/payment-limits.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import { RateLimitingModule } from '../../rate-limiting/rate-limiting.module';
import { KycService } from '../kyc/kyc.service';
import { CustomersService } from '../customers/customers.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || (() => {
          throw new Error('JWT_SECRET is required in environment variables');
        })(),
        signOptions: { 
          // SECURITY FIX: Reduced token expiration (15 minutes for access tokens)
          expiresIn: configService.get('JWT_EXPIRES_IN') || '15m' 
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    EmailModule,
    RateLimitingModule,
    HttpModule,
  ],
  controllers: [
    AuthController, 
    MerchantAuthController,
    OAuthController,
    KycController,        // ✅ NEW
    CustomersController,  // ✅ NEW
  ],
  providers: [
    AuthService,
    JwtStrategy,
    // GoogleOAuthStrategy, // ⚠️ COMMENTED OUT: Uncomment when Google OAuth env vars are configured
    JwtAuthGuard,
    PaymentLimitsGuard,   // ✅ NEW
    KycService,           // ✅ NEW
    CustomersService,     // ✅ NEW
  ],
  exports: [
    AuthService,
    JwtModule,
    JwtAuthGuard,
    PaymentLimitsGuard,   // ✅ NEW
    KycService,           // ✅ NEW
  ],
})
export class AuthModule {}
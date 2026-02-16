// src/auth/strategies/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Try Authorization header first
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback to cookie
        (request: any) => {
          return request?.cookies?.accessToken || null;
        },
      ]),
      ignoreExpiration: false,
      // Enforce strong JWT secret (minimum 32 characters)
      secretOrKey: (() => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is required in environment variables');
        }
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must be at least 32 characters');
        }
        return secret;
      })(),
    });
  }

  async validate(payload: any) {
    // Basic payload validation
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // -----------------------------------------------------------------
    // SECURITY FIX: Verify that the user still exists and is active.
    // This prevents token reuse after account deletion or deactivation.
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    const user = await this.authService.validateUser(payload);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.isDisabled) {
      throw new UnauthorizedException('User account is disabled');
    }

    // OPTIONAL: Token revocation check (placeholder – implement in AuthService)
    // if (await this.authService.isTokenRevoked(payload.jti)) {
    //   throw new UnauthorizedException('Token has been revoked');
    // }

    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role ?? (payload.type === 'customer' ? 'CUSTOMER' : null),
      type: payload.type,
      tenantId: user.tenantId,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
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

    // Determine role and type from user object or payload
    // Priority: user.role > payload.type inference > payload.role
    let role = user.role;
    if (!role && payload.type === 'customer') {
      role = 'CUSTOMER';
    } else if (!role && payload.type === 'customer_employee') {
      role = 'CUSTOMER_EMPLOYEE';
    } else if (!role && payload.role) {
      role = payload.role;
    }
    
    // Determine type from payload or infer from role
    let type = payload.type;
    if (!type && role === 'CUSTOMER') {
      type = 'customer';
    } else if (!type && role === 'CUSTOMER_EMPLOYEE') {
      type = 'customer_employee';
    }

    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: role || null,
      type: type || null,
      tenantId: user.tenantId,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
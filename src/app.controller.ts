import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return {
      success: true,
      service: 'core',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }
}


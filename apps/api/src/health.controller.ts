import { Controller, Get } from '@nestjs/common';
import { env } from './config/env';
import { Public } from './auth/public.decorator';

@Controller('api')
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return {
      ok: true,
      db: env.dbDriver,
      storage: env.storageDriver,
      time: new Date().toISOString(),
    };
  }
}

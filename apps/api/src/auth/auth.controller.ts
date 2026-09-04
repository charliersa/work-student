import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { loginSchema, type LoginInput, type MeDto } from '@ws/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { env } from '../config/env';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './jwt.guard';

function cookieOpts(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true, // JS 讀不到 → XSS 也偷不走 token
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

@Controller('api')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const me = await this.auth.login(body.account, body.password);
    const { access, refresh } = await this.auth.issueTokens(me.id, me.role);
    res.cookie(ACCESS_COOKIE, access, cookieOpts(env.accessTokenTtl));
    res.cookie(REFRESH_COOKIE, refresh, cookieOpts(env.refreshTokenTtl));
    return me;
  }

  @Public()
  @Post('auth/refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const token = (req as any).cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('請先登入');
    const me = await this.auth.refresh(token);
    const { access, refresh } = await this.auth.issueTokens(me.id, me.role);
    res.cookie(ACCESS_COOKIE, access, cookieOpts(env.accessTokenTtl));
    res.cookie(REFRESH_COOKIE, refresh, cookieOpts(env.refreshTokenTtl));
    return me;
  }

  @Public()
  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): MeDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      studentNo: user.studentNo,
      role: user.role,
    };
  }
}

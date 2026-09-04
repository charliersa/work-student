import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { verifyToken, type AccessClaims } from './tokens';
import { IS_PUBLIC } from './public.decorator';
import type { AuthUser } from '../common/current-user.decorator';

export const ACCESS_COOKIE = 'ws_access';
export const REFRESH_COOKIE = 'ws_refresh';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('請先登入');

    let claims: AccessClaims;
    try {
      claims = await verifyToken<AccessClaims>(token, 'access');
    } catch {
      throw new UnauthorizedException('登入已過期，請重新登入');
    }

    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, Number(claims.sub)))
      .limit(1);

    if (!row || !row.isActive) throw new UnauthorizedException('帳號不存在或已停用');

    req.user = {
      id: row.id,
      email: row.email,
      name: row.name,
      studentNo: row.studentNo,
      role: row.role,
    };
    return true;
  }
}

function extractToken(req: Request): string | null {
  const cookies = (req as any).cookies as Record<string, string> | undefined;
  if (cookies?.[ACCESS_COOKIE]) return cookies[ACCESS_COOKIE];
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

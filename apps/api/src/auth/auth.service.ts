import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash as argonHash, verify } from '@node-rs/argon2';
import { eq, or, sql } from 'drizzle-orm';
import type { MeDto } from '@ws/shared';
import { DB } from '../db/db.module';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { env } from '../config/env';
import { signToken, verifyToken, type AccessClaims, type RefreshClaims } from './tokens';

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** account 可以是 email 或學號 */
  async login(account: string, password: string): Promise<MeDto> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(or(sql`lower(${users.email}) = lower(${account})`, eq(users.studentNo, account)))
      .limit(1);

    // 帳號不存在時也跑一次雜湊比對，避免用回應時間探測帳號是否存在
    const target = user?.passwordHash ?? (await dummyHash());
    const ok = await verify(target, password).catch(() => false);

    if (!user || !ok || !user.isActive) {
      throw new UnauthorizedException('帳號或密碼錯誤');
    }
    return toMe(user);
  }

  async issueTokens(userId: number, role: string) {
    const access = await signToken({ typ: 'access', sub: String(userId), role }, env.accessTokenTtl);
    const refresh = await signToken({ typ: 'refresh', sub: String(userId) }, env.refreshTokenTtl);
    return { access, refresh };
  }

  async refresh(refreshToken: string): Promise<MeDto> {
    let claims: RefreshClaims;
    try {
      claims = await verifyToken<RefreshClaims>(refreshToken, 'refresh');
    } catch {
      throw new UnauthorizedException('登入已過期，請重新登入');
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, Number(claims.sub)))
      .limit(1);
    if (!user || !user.isActive) throw new UnauthorizedException('帳號不存在或已停用');
    return toMe(user);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    return verifyToken<AccessClaims>(token, 'access');
  }
}

function toMe(user: typeof users.$inferSelect): MeDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    studentNo: user.studentNo,
    role: user.role,
  };
}

/** 真實格式的假雜湊，僅用於等時比對（首次呼叫時產生並快取） */
let cachedDummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  cachedDummy ??= argonHash('__no_such_account__');
  return cachedDummy;
}

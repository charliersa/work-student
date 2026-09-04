import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env';

const secret = new TextEncoder().encode(env.jwtSecret);

export type TokenType = 'access' | 'refresh' | 'upload' | 'download';

export interface AccessClaims extends JWTPayload {
  typ: 'access';
  sub: string;
  role: string;
}
export interface RefreshClaims extends JWTPayload {
  typ: 'refresh';
  sub: string;
}
/** 本機儲存驅動用來模擬 S3 presigned PUT 的短效 token */
export interface UploadClaims extends JWTPayload {
  typ: 'upload';
  key: string;
  submissionId: number;
  uid: number;
  maxSize: number;
  originalName: string;
}
/** 模擬 S3 presigned GET */
export interface DownloadClaims extends JWTPayload {
  typ: 'download';
  key: string;
  filename: string;
  mimeType: string;
}

export async function signToken(claims: JWTPayload & { typ: TokenType }, ttlSeconds: number): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyToken<T extends JWTPayload>(token: string, expectedType: TokenType): Promise<T> {
  const { payload } = await jwtVerify(token, secret);
  if ((payload as any).typ !== expectedType) {
    throw new Error(`token 類型錯誤：預期 ${expectedType}`);
  }
  return payload as T;
}

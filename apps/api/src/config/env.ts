import * as dotenv from 'dotenv';
import * as path from 'node:path';

// 依序載入 repo 根目錄與 apps/api 底下的 .env（後者可覆寫前者）
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function str(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`缺少環境變數 ${key}`);
  return v;
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : Number(v);
}

const port = num('PORT', 3000);

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',

  port,
  webOrigin: str('WEB_ORIGIN', 'http://localhost:5173'),
  // 預設跟著 PORT 走：只改 PORT 時，簽發出去的上傳/下載網址不會還指著 3000
  apiPublicUrl: str('API_PUBLIC_URL', `http://localhost:${port}`),

  dbDriver: str('DB_DRIVER', 'pglite') as 'pglite' | 'pg',
  pgliteDataDir: str('PGLITE_DATA_DIR', './.data/pg'),
  databaseUrl: process.env.DATABASE_URL ?? '',

  storageDriver: str('STORAGE_DRIVER', 'local') as 'local' | 's3',
  localStorageDir: str('LOCAL_STORAGE_DIR', './.storage'),
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'auto',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },

  jwtSecret: str('JWT_SECRET', 'dev-only-secret-change-me-in-production-please'),
  accessTokenTtl: num('ACCESS_TOKEN_TTL', 900),
  refreshTokenTtl: num('REFRESH_TOKEN_TTL', 1209600),
  uploadUrlTtl: num('UPLOAD_URL_TTL', 300),
  downloadUrlTtl: num('DOWNLOAD_URL_TTL', 300),
};

if (env.isProd && env.jwtSecret.startsWith('dev-only-secret')) {
  throw new Error('正式環境必須設定自己的 JWT_SECRET');
}

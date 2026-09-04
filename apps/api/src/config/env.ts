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
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const port = num('PORT', 3000);

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',

  port,
  webOrigin: str('WEB_ORIGIN', 'http://localhost:5173'),
  // 預設跟著 PORT 走：只改 PORT 時，簽發出去的上傳/下載網址不會還指著 3000
  apiPublicUrl: str('API_PUBLIC_URL', `http://localhost:${port}`),
  /**
   * 使用者是否「明確」設定了 API_PUBLIC_URL。
   * 沒設定時，本機儲存驅動會簽發「相對路徑」的上傳/下載網址 —— 前端與 API 同源，
   * 相對路徑在任何主機名稱下都成立。這樣裝在老師電腦上時，學生從 192.168.x.x 連進來
   * 也不會被導回 localhost（那會變成 PUT 到學生自己的電腦）。
   */
  apiPublicUrlExplicit: !!process.env.API_PUBLIC_URL,

  /**
   * cookie 是否加上 Secure 旗標。加了就只能走 HTTPS。
   * 校內區網用純 HTTP 直連老師電腦時必須關掉，否則瀏覽器會靜默丟棄登入 cookie ——
   * 症狀是「登入看起來成功，但下一頁就變成未登入」，極難查。
   */
  cookieSecure: bool('COOKIE_SECURE', (process.env.NODE_ENV ?? 'development') === 'production'),

  // 正式環境由 API 自己托管前端靜態檔：前後端同源，httpOnly cookie 不必處理 CORS，
  // 而且只有一個服務要部署。開發時走 vite dev server，所以預設只在 production 開啟。
  serveWeb: bool('SERVE_WEB', (process.env.NODE_ENV ?? 'development') === 'production'),
  webDistDir: process.env.WEB_DIST_DIR ?? '', // 留空則自動尋找

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

/**
 * 正式環境不接受範本裡的佔位字串或過短的金鑰 —— 金鑰太弱等於任何人都能偽造登入憑證，
 * 而且這種問題不會有任何徵兆，只能在啟動時就攔下來。
 *
 * 刻意做成函式而不是在模組載入時直接 throw：在模組載入階段拋出的例外會繞過
 * main.ts 的錯誤處理，變成一大串 stack trace，對負責安裝的老師來說毫無幫助。
 * 由 bootstrap 呼叫，才能印出乾淨的一行說明。
 */
export function validateEnv(): void {
  if (!env.isProd) return;

  const genHint = '產生方式：\n  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
  const placeholders = ['dev-only-secret', '請換掉這一行', 'changeme', 'change-me'];

  if (placeholders.some((p) => env.jwtSecret.includes(p))) {
    throw new Error(`JWT_SECRET 還是設定範本裡的預設值，請打開 .env 換成自己的。\n${genHint}`);
  }
  if (env.jwtSecret.length < 32) {
    throw new Error(`JWT_SECRET 太短（目前 ${env.jwtSecret.length} 字元），至少要 32 字元。\n${genHint}`);
  }
}

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { env } from './config/env';
import { runMigrations } from './db/migrate';

/** 對單一位址試連，連得上代表已經有人在聽 */
function isTaken(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (taken: boolean) => {
      sock.destroy();
      resolve(taken);
    };
    sock.setTimeout(1000);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/**
 * 啟動前先確認 port 沒被佔用。
 *
 * 為什麼不能只依賴 EADDRINUSE：Node 預設綁 `0.0.0.0` 與 `[::]`，而 VSCode Live Preview
 * 這類工具只綁 `127.0.0.1`。在 Windows 上兩者可以「同時」listen 同一個 port 而不報錯，
 * 接著 `localhost` 解析成 IPv4 還是 IPv6 就決定請求打到誰 —— 同一個指令跑兩次結果可能不同。
 * 這種間歇性錯誤極難追，所以寧可在這裡就直接拒絕啟動。
 */
async function assertPortFree(port: number): Promise<void> {
  const hosts = ['127.0.0.1', '::1'];
  const busy = (await Promise.all(hosts.map(async (h) => ((await isTaken(h, port)) ? h : null)))).filter(
    (h): h is string => h !== null,
  );
  if (busy.length === 0) return;

  throw new Error(
    [
      `port ${port} 已經被其他程式佔用（${busy.join('、')}）。`,
      '',
      '在 VSCode 裡最常見的原因是 Live Preview：它會 serve 專案根目錄的 index.html，',
      '並且同時佔用 3000（HTTP）與 3001（WebSocket）。注意關掉預覽分頁不會停掉伺服器 ——',
      '要用命令面板執行「Live Preview: Stop Server」，或到「連接埠 / Ports」面板移除該連接埠。',
      '',
      '也可以直接換一個 port：在 .env 設 PORT=3100（前端 proxy 與 API_PUBLIC_URL 會自動跟著走）。',
    ].join('\n'),
  );
}

/**
 * 找出已建置的前端。依序試：明確指定的 WEB_DIST_DIR → 容器內的 public/ → monorepo 的 apps/web/dist。
 * 找不到就回傳 null，API 仍可單獨運作（例如前端另外部署到 CDN 的情況）。
 */
function resolveWebDir(): string | null {
  const candidates = [
    env.webDistDir,
    path.resolve(__dirname, '../public'), // Docker：前端建置產物複製到 apps/api/public
    path.resolve(__dirname, '../../web/dist'), // monorepo：apps/web/dist
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

/** 這台機器上可供區網其他電腦連入的 IPv4 位址（裝在老師電腦時，學生要連的就是這個） */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((ifaces) => ifaces ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

async function bootstrap() {
  const logger = new Logger('bootstrap');

  await assertPortFree(env.port);

  const ran = await runMigrations();
  if (ran.length) logger.log(`已套用 migration：${ran.join(', ')}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // 檔案位元組走 presigned URL 直傳，API 本身不需要吃大 body
    bodyParser: true,
  });

  app.use(cookieParser());
  app.enableCors({
    origin: [env.webOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  let webDir: string | null = null;
  if (env.serveWeb) {
    webDir = resolveWebDir();
    if (webDir) {
      // index: false —— 首頁一律走下面的 SPA fallback，避免 index.html 被瀏覽器長時間快取
      app.useStaticAssets(webDir, { index: false, maxAge: '1y', immutable: true });

      // SPA fallback：直接輸入 /courses/1 或按重新整理時，仍要回傳 index.html 讓前端路由接手。
      // 這段 middleware 會排在 Nest router 之前，所以必須自己把 /api 與帶副檔名的請求放行。
      const indexHtml = path.join(webDir, 'index.html');
      app.use((req: any, res: any, next: () => void) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api')) return next();
        if (path.extname(req.path)) return next(); // 靜態資源沒命中就讓它照常 404
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      });
    } else {
      logger.warn('SERVE_WEB 已開啟，但找不到前端建置產物，只會提供 API');
    }
  }

  await app.listen(env.port);
  logger.log(`API 已啟動：http://localhost:${env.port}/api/health`);
  logger.log(`資料庫 driver=${env.dbDriver}，儲存 driver=${env.storageDriver}`);
  logger.log(webDir ? `前端由 API 托管：${webDir}` : '前端未由 API 托管（開發時走 vite dev server）');
  logger.log(
    env.cookieSecure
      ? '登入 cookie：Secure（只能走 HTTPS；若用純 HTTP 連線會登不進去，請設 COOKIE_SECURE=false）'
      : '登入 cookie：非 Secure（可走純 HTTP；僅適用於校內區網等封閉環境）',
  );

  // 裝在老師電腦上時，老師要把這個網址給學生 —— 直接印出來，免得還得自己查 ipconfig
  if (webDir) {
    const urls = lanAddresses().map((ip) => `http://${ip}:${env.port}`);
    logger.log(`本機開啟：http://localhost:${env.port}`);
    if (urls.length) logger.log(`同一個區網的學生請連：${urls.join('　或　')}`);
    else logger.warn('偵測不到區網 IP，其他電腦可能連不進來（請確認網路連線）');
  }
}

bootstrap().catch((err) => {
  // 設定錯誤（port 被佔、JWT_SECRET 沒換…）要讓人一眼看懂，不要丟一整頁 stack
  new Logger('bootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

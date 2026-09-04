import 'reflect-metadata';
import * as net from 'node:net';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

async function bootstrap() {
  const logger = new Logger('bootstrap');

  await assertPortFree(env.port);

  const ran = await runMigrations();
  if (ran.length) logger.log(`已套用 migration：${ran.join(', ')}`);

  const app = await NestFactory.create(AppModule, {
    // 檔案位元組走 presigned URL 直傳，API 本身不需要吃大 body
    bodyParser: true,
  });

  app.use(cookieParser());
  app.enableCors({
    origin: [env.webOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.listen(env.port);
  logger.log(`API 已啟動：http://localhost:${env.port}/api/health`);
  logger.log(`資料庫 driver=${env.dbDriver}，儲存 driver=${env.storageDriver}`);
}

bootstrap().catch((err) => {
  // 設定錯誤（port 被佔、JWT_SECRET 沒換…）要讓人一眼看懂，不要丟一整頁 stack
  new Logger('bootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

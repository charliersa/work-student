import * as path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // API port 以 repo 根目錄的 .env 為準：改了 PORT，前端 proxy 才會跟著走，
  // 否則會安靜地 proxy 到 3000 上的別人（例如 VSCode Live Preview）。
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = rootEnv.PORT || '3000';

  return {
    plugins: [react()],
    // @ws/shared 編譯成 CommonJS 給 NestJS 用，這裡強制預先打包成 ESM
    optimizeDeps: { include: ['@ws/shared'] },
    build: { commonjsOptions: { include: [/shared/, /node_modules/] } },
    server: {
      port: 5173,
      // 讓前端與 API 在開發時同源，cookie 才會乖乖跟著送。
      // 目標寫 127.0.0.1 而非 localhost：後者可能解析到 ::1，撞上只綁 IPv4 的其他服務。
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
  };
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { env } from '../config/env';

export type Db = NodePgDatabase<typeof schema>;

export interface DbBundle {
  db: Db;
  /** 執行多段 SQL（migration 用） */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** 在 CommonJS 產物中仍能載入 ESM-only 套件 */
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

let bundle: DbBundle | null = null;

export async function getDb(): Promise<DbBundle> {
  if (bundle) return bundle;

  if (env.dbDriver === 'pg') {
    const { Pool } = await import('pg');
    if (!env.databaseUrl) throw new Error('DB_DRIVER=pg 時必須設定 DATABASE_URL');
    const pool = new Pool({ connectionString: env.databaseUrl });
    bundle = {
      db: drizzlePg(pool, { schema }),
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  } else {
    // 開發預設：嵌入式 Postgres，免安裝任何服務
    const { PGlite } = await dynamicImport('@electric-sql/pglite');
    const { drizzle: drizzlePglite } = await dynamicImport('drizzle-orm/pglite');
    const dir = path.resolve(process.cwd(), env.pgliteDataDir);
    fs.mkdirSync(path.dirname(dir), { recursive: true }); // PGlite 自己的 mkdir 不是遞迴的
    const client = new PGlite(dir);
    await client.waitReady;
    bundle = {
      db: drizzlePglite(client, { schema }) as unknown as Db,
      exec: async (sql) => {
        await client.exec(sql);
      },
      close: () => client.close(),
    };
  }

  return bundle;
}

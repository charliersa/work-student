/**
 * 極簡 migration runner：依檔名排序執行 migrations/*.sql，已執行過的略過。
 * 同一份 SQL 在 PGlite 與正式 PostgreSQL 上都會執行。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { env } from '../config/env';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export async function runMigrations(): Promise<string[]> {
  const { db, exec } = await getDb();

  await exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await db.execute<{ name: string }>(sql`SELECT name FROM _migrations`)).rows.map((r) => r.name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await exec(content);
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
    ran.push(file);
  }
  return ran;
}

if (require.main === module) {
  runMigrations()
    .then(async (ran) => {
      console.log(
        ran.length
          ? `已套用 migration：${ran.join(', ')}（driver=${env.dbDriver}）`
          : `資料庫已是最新（driver=${env.dbDriver}）`,
      );
      const { close } = await getDb();
      await close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration 失敗：', err);
      process.exit(1);
    });
}

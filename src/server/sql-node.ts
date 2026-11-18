import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Executor } from './sql.js';

/** node:sqlite implementation — used by the dev server, VPS, Docker and Render deployments. */
export function createNodeExecutor(): Executor {
  const dbPath = process.env.DATABASE_PATH?.trim()
    ? path.resolve(process.env.DATABASE_PATH.trim())
    : path.resolve(process.cwd(), 'data', 'airdrop.db');

  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // WAL mode & foreign keys for high concurrency between Bot and Web API
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  return {
    async get<T>(sql: string, params: any[]): Promise<T | undefined> {
      return db.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async all<T>(sql: string, params: any[]): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: any[]) {
      const result = db.prepare(sql).run(...(params as never[]));
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
}

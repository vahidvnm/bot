import type { Executor } from './sql.js';

/** Minimal D1 binding typings (kept local so no Cloudflare types package is required). */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number; last_insert_rowid: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<void>;
}

/**
 * Cloudflare D1 implementation — used by the Workers deployment
 * (free tier: millions of reads + 100k writes/day, zero cold-start cost).
 */
export function createD1Executor(db: D1DatabaseLike): Executor {
  const bind = (stmt: D1PreparedStatement, params: any[]) =>
    stmt.bind(...params.map((p) => (p === undefined ? null : p)));

  return {
    async get<T>(sql: string, params: any[]): Promise<T | undefined> {
      const row = await bind(db.prepare(sql), params).first<T>();
      return row === null ? undefined : row;
    },
    async all<T>(sql: string, params: any[]): Promise<T[]> {
      const res = await bind(db.prepare(sql), params).all<T>();
      return res.results;
    },
    async run(sql: string, params: any[]) {
      const res = await bind(db.prepare(sql), params).run();
      return {
        changes: res.meta.changes,
        lastInsertRowid: res.meta.last_insert_rowid,
      };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
  };
}

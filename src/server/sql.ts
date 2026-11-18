/**
 * Tiny async SQL abstraction so the exact same data layer runs on:
 *  - Node.js (node:sqlite)          → sql-node.ts  (dev server, VPS, Docker, Render)
 *  - Cloudflare Workers (D1)        → sql-d1.ts    (Workers free tier)
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Executor {
  get<T = any>(sql: string, params: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params: any[]): Promise<T[]>;
  run(sql: string, params: any[]): Promise<RunResult>;
  /** Execute one or more statements (DDL, seeds). */
  exec(sql: string): Promise<void>;
}

let executor: Executor | null = null;

export function setExecutor(e: Executor): void {
  executor = e;
}

export function hasExecutor(): boolean {
  return executor !== null;
}

export function getExecutor(): Executor {
  if (!executor) {
    throw new Error('Database executor not initialised');
  }
  return executor;
}

export interface Stmt {
  get(...params: any[]): Promise<any>;
  all(...params: any[]): Promise<any[]>;
  run(...params: any[]): Promise<RunResult>;
}

/** prepare(sql).get/all/run — mirrors the old node:sqlite statement API, but async. */
export function prepare(sql: string): Stmt {
  return {
    get: (...params) => getExecutor().get(sql, params),
    all: (...params) => getExecutor().all(sql, params),
    run: (...params) => getExecutor().run(sql, params),
  };
}

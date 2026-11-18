/**
 * Cloudflare Workers entry (free tier).
 *  - D1 (SQLite) for persistence
 *  - Workers Static Assets for the Mini App frontend
 *  - Telegram webhook instead of long polling (auto-configured from the request origin)
 */
import { handleRequest, isApiPath } from './app.js';
import { setRuntimeEnv } from './config.js';
import { setExecutor } from './sql.js';
import { createD1Executor, type D1DatabaseLike } from './sql-d1.js';
import { ensureSchema } from './db.js';
import {
  ensureWebhook,
  handleWebhookUpdate,
  setWorkerOrigin,
  webhookSecret,
} from '../bot/index.js';

interface WorkerEnv {
  DB: D1DatabaseLike;
  ASSETS: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}

let runtimeReady: Promise<void> | null = null;

async function ensureRuntime(env: WorkerEnv): Promise<void> {
  if (!runtimeReady) {
    runtimeReady = (async () => {
      setRuntimeEnv(env);
      setExecutor(createD1Executor(env.DB));
      await ensureSchema();
    })().catch((err) => {
      runtimeReady = null; // allow retry on next request
      throw err;
    });
  }
  await runtimeReady;
}

async function handleWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('ok');
  }
  const token = typeof env.BOT_TOKEN === 'string' ? env.BOT_TOKEN.trim() : '';
  if (!token) {
    return new Response('bot not configured', { status: 404 });
  }
  const secret = await webhookSecret(token);
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const update = await request.json();
    await handleWebhookUpdate(update);
    return new Response('ok');
  } catch (err) {
    console.error('[Webhook] update failed:', (err as Error).message);
    // Acknowledge anyway so Telegram does not retry a poisoned update forever
    return new Response('ok');
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
    setRuntimeEnv(env); // cheap; keeps bindings fresh across requests
    await ensureRuntime(env);

    const url = new URL(request.url);
    setWorkerOrigin(url.origin);

    if (url.pathname === '/telegram/webhook') {
      return handleWebhook(request, env);
    }

    if (isApiPath(url.pathname)) {
      // Keep the webhook pointed at this deployment (once per isolate, off the critical path)
      ctx.waitUntil(ensureWebhook(url.origin));
      return handleRequest(request);
    }

    return env.ASSETS.fetch(request);
  },
};

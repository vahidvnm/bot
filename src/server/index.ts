/**
 * Node entry — dev server (Vite), VPS/Docker/Render production.
 * Bridges node:http into the shared fetch app (src/server/app.ts) so the EXACT
 * same API code also runs on Cloudflare Workers (src/server/worker.ts).
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setExecutor } from './sql.js';
import { createNodeExecutor } from './sql-node.js';
import { ensureSchema } from './db.js';
import { handleRequest } from './app.js';
import { startTelegramBot } from '../bot/index.js';

const MAX_BODY_BYTES = 1_000_000;

function toWebRequest(req: IncomingMessage, rawBody: Buffer | null): Request {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0];
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0];
  const proto = forwardedProto || 'http';
  const host = forwardedHost || req.headers.host || 'localhost:3000';
  const url = `${proto}://${host}${req.url || '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const method = (req.method || 'GET').toUpperCase();
  const init: RequestInit = { method, headers };
  if (rawBody && method !== 'GET' && method !== 'HEAD') {
    init.body = new Uint8Array(rawBody);
  }
  return new Request(url, init);
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key === 'content-length') return;
    try {
      res.setHeader(key, value);
    } catch {
      // skip invalid header names
    }
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

async function bootstrap() {
  setExecutor(createNodeExecutor());
  await ensureSchema();

  const app = express();
  app.set('trust proxy', true);

  // ---- API bridge: buffer the body, convert to Request, run the shared fetch app ----
  const isApiRequest = (p: string) =>
    p.startsWith('/api/') || p === '/tonconnect-manifest.json';

  app.use((req, res, next) => {
    if (!isApiRequest(req.path)) return next();

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.status(413).json({ error: 'Payload too large' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => {
      if (!aborted) next(err);
    });

    req.on('end', async () => {
      if (aborted) return;
      try {
        const raw = chunks.length ? Buffer.concat(chunks) : null;
        const request = toWebRequest(req, raw);
        const response = await handleRequest(request);
        await sendWebResponse(res, response);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: (err as Error).message });
        }
      }
    });
  });

  // ---- Frontend serving (Vite dev middleware or prod static) ----
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false, // Clean stability inside proxied HTTPS preview environments
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distClient = path.resolve(process.cwd(), 'dist/client');
    const publicDir = path.resolve(process.cwd(), 'public');
    if (fs.existsSync(publicDir)) {
      app.use(express.static(publicDir));
    }
    app.use(express.static(distClient));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distClient, 'index.html'));
    });
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Server] Airdrop Mini App & API listening on http://0.0.0.0:${port}`);
  });

  await startTelegramBot();
}

bootstrap().catch((err) => {
  console.error('[Fatal] Startup error:', err);
  process.exit(1);
});

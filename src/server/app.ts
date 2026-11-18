/**
 * Fetch-API application — the single source of HTTP truth for the airdrop.
 * Runs unchanged on:
 *   - Node (src/server/index.ts bridges node:http → this, serves Vite/static)
 *   - Cloudflare Workers (src/server/worker.ts, serves D1 + Static Assets)
 */
import {
  adjustUserBalance,
  buildUserState,
  claimDailyReward,
  claimMiningStorage,
  completeTaskForUser,
  connectUserWallet,
  createAdminTask,
  deleteAdminTask,
  disconnectUserWallet,
  exportAirdropSnapshotCsv,
  getAdminAllTasks,
  getAdminStats,
  getLeaderboard,
  getSettings,
  getTaskById,
  getUserReferrals,
  getUserTasks,
  getUserTransactions,
  listAdminUsers,
  processTaps,
  refillEnergy,
  setUserBanStatus,
  toggleAdminTask,
  updateSettings,
  upgradeBoost,
} from './db.js';
import { HttpError, requireAdmin, requireAuth } from './auth.js';
import { env } from './config.js';
import {
  broadcastMessageToUsers,
  getBotStatus,
  verifyTelegramChannelMembership,
} from '../bot/index.js';
import type { BoostType } from '../shared/types.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

const MAX_BODY_BYTES = 1_000_000; // matches the old express.json({ limit: '1mb' })

async function readJson(req: Request): Promise<any> {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return {};
  const text = await req.text();
  if (!text) return {};
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// ================= ROUTER =================

interface RouteCtx {
  req: Request;
  url: URL;
  params: Record<string, string>;
}
type RouteHandler = (ctx: RouteCtx) => Promise<Response>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function route(method: string, pattern: string, handler: RouteHandler): void {
  const keys: string[] = [];
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((part) => {
          if (part.startsWith(':')) {
            keys.push(part.slice(1));
            return '([^/]+)';
          }
          return escapeRe(part);
        })
        .join('/') +
      '$'
  );
  routes.push({ method, regex, keys, handler });
}

// ================= TON CONNECT MANIFEST =================

async function tonconnectManifest(req: Request, url: URL): Promise<Response> {
  const settings = await getSettings();
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0] || url.protocol.replace(':', '') || 'https';
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0] || url.host || 'localhost:3000';
  const detectedOrigin = `${proto}://${host}`;
  const appOrigin = (env('WEBAPP_URL') || '').trim().replace(/\/$/, '') || detectedOrigin;

  return json(
    {
      url: appOrigin,
      name: `${settings.tokenName} ($${settings.tokenSymbol}) Airdrop`,
      iconUrl: `${appOrigin}/logo-180.png`,
    },
    200,
    {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    }
  );
}

route('GET', '/tonconnect-manifest.json', ({ req, url }) => tonconnectManifest(req, url));
route('OPTIONS', '/tonconnect-manifest.json', async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    },
  })
);

// ================= HEALTH =================

route('GET', '/api/health', async () =>
  json({ ok: true, bot: await getBotStatus(), timestamp: new Date().toISOString() })
);

// ================= USER API =================

route('GET', '/api/state', async ({ req }) => {
  const u = await requireAuth(req);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ ...state, botStatus: await getBotStatus() });
});

route('POST', '/api/claim-daily', async ({ req }) => {
  const u = await requireAuth(req);
  const claim = await claimDailyReward(u.telegramId);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ claim, state });
});

route('POST', '/api/claim-mining', async ({ req }) => {
  const u = await requireAuth(req);
  const harvest = await claimMiningStorage(u.telegramId);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ harvest, state });
});

route('POST', '/api/tap', async ({ req }) => {
  const u = await requireAuth(req);
  const body = await readJson(req);
  const taps = Number(body?.taps ?? 1);
  const result = await processTaps(u.telegramId, taps);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ result, state });
});

route('POST', '/api/refill-energy', async ({ req }) => {
  const u = await requireAuth(req);
  const refill = await refillEnergy(u.telegramId);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ refill, state });
});

route('POST', '/api/boosts/upgrade', async ({ req }) => {
  const u = await requireAuth(req);
  const body = await readJson(req);
  const boostType = body?.boostType as BoostType;
  const upgrade = await upgradeBoost(u.telegramId, boostType);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ upgrade, state });
});

route('POST', '/api/wallet/connect', async ({ req }) => {
  const u = await requireAuth(req);
  const body = await readJson(req);
  const address = String(body?.address || '');
  const provider = String(body?.provider || 'TON Connect');
  const walletResult = await connectUserWallet(u.telegramId, address, provider);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ walletResult, state });
});

route('POST', '/api/wallet/disconnect', async ({ req }) => {
  const u = await requireAuth(req);
  await disconnectUserWallet(u.telegramId);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  return json({ state });
});

route('GET', '/api/tasks', async ({ req }) => {
  const u = await requireAuth(req);
  return json({ tasks: await getUserTasks(u.telegramId) });
});

route('POST', '/api/tasks/:id/claim', async ({ req, params }) => {
  const u = await requireAuth(req);
  const taskId = parseInt(params.id, 10);
  const task = await getTaskById(taskId);
  if (!task) {
    return json({ error: 'Task not found' }, 404);
  }

  if (task.verificationType === 'telegram_channel' && task.targetValue) {
    const check = await verifyTelegramChannelMembership(task.targetValue, u.telegramId);
    if (!check.ok) {
      return json({ error: check.reason || 'Channel membership not verified yet.' }, 400);
    }
  }

  const claimed = await completeTaskForUser(u.telegramId, taskId);
  const state = await buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
  const tasks = await getUserTasks(u.telegramId);
  return json({ claimed, state, tasks });
});

route('GET', '/api/referrals', async ({ req }) => {
  const u = await requireAuth(req);
  return json({ referrals: await getUserReferrals(u.telegramId) });
});

route('GET', '/api/leaderboard', async ({ req }) => {
  await requireAuth(req);
  return json({ leaderboard: await getLeaderboard(50) });
});

route('GET', '/api/transactions', async ({ req }) => {
  const u = await requireAuth(req);
  return json({ transactions: await getUserTransactions(u.telegramId, 30) });
});

// ================= ADMIN API =================

route('GET', '/api/admin/overview', async ({ req, url }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const search = url.searchParams.get('search') || '';
  return json({
    stats: await getAdminStats(),
    settings: await getSettings(),
    botStatus: await getBotStatus(),
    tasks: await getAdminAllTasks(),
    users: await listAdminUsers(search, 50),
  });
});

route('PUT', '/api/admin/settings', async ({ req }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const updated = await updateSettings(body || {});
  return json({ settings: updated });
});

route('POST', '/api/admin/tasks', async ({ req }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const { title, description, category, reward, actionUrl, verificationType, targetValue } =
    body || {};
  if (!title || !reward) {
    return json({ error: 'Title and reward are required.' }, 400);
  }
  const created = await createAdminTask({
    title: String(title),
    description: String(description || ''),
    category: category || 'social',
    reward: Number(reward),
    actionUrl: actionUrl ? String(actionUrl) : null,
    verificationType: verificationType || 'external_link',
    targetValue: targetValue ? String(targetValue) : null,
  });
  return json({ task: created, tasks: await getAdminAllTasks() });
});

route('PATCH', '/api/admin/tasks/:id', async ({ req, params }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const id = parseInt(params.id, 10);
  await toggleAdminTask(id, Boolean(body?.isActive));
  return json({ tasks: await getAdminAllTasks() });
});

route('DELETE', '/api/admin/tasks/:id', async ({ req, params }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const id = parseInt(params.id, 10);
  await deleteAdminTask(id);
  return json({ tasks: await getAdminAllTasks() });
});

route('POST', '/api/admin/users/:id/adjust', async ({ req, params }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const id = parseInt(params.id, 10);
  const delta = Number(body?.delta || 0);
  const reason = String(body?.reason || 'Admin balance adjustment');
  await adjustUserBalance(id, delta, reason);
  return json({ ok: true, users: await listAdminUsers('', 50), stats: await getAdminStats() });
});

route('POST', '/api/admin/users/:id/ban', async ({ req, params }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const id = parseInt(params.id, 10);
  await setUserBanStatus(id, Boolean(body?.banned));
  return json({ ok: true, users: await listAdminUsers('', 50), stats: await getAdminStats() });
});

route('POST', '/api/admin/broadcast', async ({ req }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const body = await readJson(req);
  const message = String(body?.message || '').trim();
  if (!message) {
    return json({ error: 'Broadcast message cannot be empty.' }, 400);
  }
  // Batched: the Workers free plan allows ~50 subrequests per invocation.
  const result = await broadcastMessageToUsers(message, { max: 40 });
  return json({ result });
});

route('GET', '/api/admin/export-csv', async ({ req }) => {
  const u = await requireAuth(req);
  await requireAdmin(req, u);
  const csv = await exportAirdropSnapshotCsv();
  const filename = `airdrop_snapshot_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ================= DISPATCH =================

export function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/tonconnect-manifest.json' ||
    pathname === '/telegram/webhook'
  );
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.regex);
    if (!m) continue;

    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(m[i + 1]);
    });

    try {
      return await r.handler({ req, url, params });
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status);
      }
      // Mirrors the old per-route try/catch → 400 { error }
      return json({ error: (err as Error).message }, 400);
    }
  }

  return json({ error: 'Not found' }, 404);
}

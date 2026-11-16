import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
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
import { requireAdmin, requireAuth } from './auth.js';
import {
  broadcastMessageToUsers,
  getBotStatus,
  startTelegramBot,
  verifyTelegramChannelMembership,
} from '../bot/index.js';
import type { BoostType } from '../shared/types.js';

async function bootstrap() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  // Dynamic TON Connect 2.0 Manifest (CORS enabled as required by Tonkeeper & Telegram Wallet)
  app.get('/tonconnect-manifest.json', (req, res) => {
    const settings = getSettings();
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0] || req.headers.host || 'localhost:3000';
    const detectedOrigin = `${proto}://${host}`;
    const appOrigin = (process.env.WEBAPP_URL || '').trim().replace(/\/$/, '') || detectedOrigin;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.json({
      url: appOrigin,
      name: `${settings.tokenName} ($${settings.tokenSymbol}) Airdrop`,
      iconUrl: `${appOrigin}/logo-180.png`,
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: getBotStatus(), timestamp: new Date().toISOString() });
  });

  // ================= USER API ROUTES =================

  app.get('/api/state', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ ...state, botStatus: getBotStatus() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/claim-daily', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const claim = claimDailyReward(u.telegramId);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ claim, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/claim-mining', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const harvest = claimMiningStorage(u.telegramId);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ harvest, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/tap', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const taps = Number(req.body?.taps ?? 1);
      const result = processTaps(u.telegramId, taps);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ result, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/refill-energy', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const refill = refillEnergy(u.telegramId);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ refill, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/boosts/upgrade', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const boostType = req.body?.boostType as BoostType;
      const upgrade = upgradeBoost(u.telegramId, boostType);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ upgrade, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/wallet/connect', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      const address = String(req.body?.address || '');
      const provider = String(req.body?.provider || 'TON Connect');
      const walletResult = connectUserWallet(u.telegramId, address, provider);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ walletResult, state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/wallet/disconnect', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      disconnectUserWallet(u.telegramId);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      res.json({ state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/tasks', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      res.json({ tasks: getUserTasks(u.telegramId) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:id/claim', requireAuth, async (req, res) => {
    try {
      const u = req.tgUser!;
      const taskId = parseInt(req.params.id, 10);
      const task = getTaskById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      if (task.verificationType === 'telegram_channel' && task.targetValue) {
        const check = await verifyTelegramChannelMembership(task.targetValue, u.telegramId);
        if (!check.ok) {
          res.status(400).json({ error: check.reason || 'Channel membership not verified yet.' });
          return;
        }
      }

      const claimed = completeTaskForUser(u.telegramId, taskId);
      const state = buildUserState(u.telegramId, u.authMode, u.isDemoAdmin);
      const tasks = getUserTasks(u.telegramId);
      res.json({ claimed, state, tasks });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/referrals', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      res.json({ referrals: getUserReferrals(u.telegramId) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/leaderboard', requireAuth, (_req, res) => {
    try {
      res.json({ leaderboard: getLeaderboard(50) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/transactions', requireAuth, (req, res) => {
    try {
      const u = req.tgUser!;
      res.json({ transactions: getUserTransactions(u.telegramId, 30) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ================= ADMIN API ROUTES =================

  app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
    const search = String(req.query.search || '');
    res.json({
      stats: getAdminStats(),
      settings: getSettings(),
      botStatus: getBotStatus(),
      tasks: getAdminAllTasks(),
      users: listAdminUsers(search, 50),
    });
  });

  app.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    try {
      const updated = updateSettings(req.body || {});
      res.json({ settings: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/admin/tasks', requireAuth, requireAdmin, (req, res) => {
    try {
      const { title, description, category, reward, actionUrl, verificationType, targetValue } =
        req.body || {};
      if (!title || !reward) {
        res.status(400).json({ error: 'Title and reward are required.' });
        return;
      }
      const created = createAdminTask({
        title: String(title),
        description: String(description || ''),
        category: category || 'social',
        reward: Number(reward),
        actionUrl: actionUrl ? String(actionUrl) : null,
        verificationType: verificationType || 'external_link',
        targetValue: targetValue ? String(targetValue) : null,
      });
      res.json({ task: created, tasks: getAdminAllTasks() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/admin/tasks/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    toggleAdminTask(id, Boolean(req.body?.isActive));
    res.json({ tasks: getAdminAllTasks() });
  });

  app.delete('/api/admin/tasks/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    deleteAdminTask(id);
    res.json({ tasks: getAdminAllTasks() });
  });

  app.post('/api/admin/users/:id/adjust', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const delta = Number(req.body?.delta || 0);
    const reason = String(req.body?.reason || 'Admin balance adjustment');
    adjustUserBalance(id, delta, reason);
    res.json({ ok: true, users: listAdminUsers('', 50), stats: getAdminStats() });
  });

  app.post('/api/admin/users/:id/ban', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    setUserBanStatus(id, Boolean(req.body?.banned));
    res.json({ ok: true, users: listAdminUsers('', 50), stats: getAdminStats() });
  });

  app.post('/api/admin/broadcast', requireAuth, requireAdmin, async (req, res) => {
    try {
      const message = String(req.body?.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'Broadcast message cannot be empty.' });
        return;
      }
      const result = await broadcastMessageToUsers(message);
      res.json({ result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/admin/export-csv', requireAuth, requireAdmin, (_req, res) => {
    const csv = exportAirdropSnapshotCsv();
    const filename = `airdrop_snapshot_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  // ================= FRONTEND SERVING (VITE DEV OR PROD STATIC) =================
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

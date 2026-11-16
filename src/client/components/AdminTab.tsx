import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  KeyRound,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import type { AppSettings, TaskCategory, TaskItem } from '../../shared/types.js';
import { api, getAdminSecret, getDemoUserId, setAdminSecret, triggerHaptic } from '../api.js';

interface AdminOverview {
  stats: {
    totalUsers: number;
    realUsers: number;
    connectedWallets: number;
    circulatingBalance: number;
    totalMinted: number;
    claimedToday: number;
    tasksCompleted: number;
  };
  settings: AppSettings;
  botStatus: {
    configured: boolean;
    running: boolean;
    username: string;
    webAppUrl: string | null;
  };
  tasks: TaskItem[];
  users: Array<{
    telegram_id: number;
    username: string | null;
    first_name: string;
    balance: number;
    total_earned: number;
    wallet_address: string | null;
    daily_streak: number;
    is_banned: number;
    created_at: string;
  }>;
}

type AdminSection = 'stats' | 'tasks' | 'users' | 'broadcast' | 'settings';

export const AdminTab: React.FC<{
  showToast: (msg: string, type?: 'success' | 'error') => void;
  tokenSymbol: string;
}> = ({ showToast, tokenSymbol }) => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<AdminSection>('stats');
  const [secretInput, setSecretInput] = useState(getAdminSecret());
  const [search, setSearch] = useState('');

  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    category: 'social' as TaskCategory,
    reward: 1000,
    actionUrl: '',
    verificationType: 'external_link' as TaskItem['verificationType'],
    targetValue: '',
  });

  const load = async (searchTerm = search) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminOverview(searchTerm);
      setOverview(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportCsv = async () => {
    try {
      const headers: Record<string, string> = {
        'X-Demo-User-Id': String(getDemoUserId()),
      };
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) headers['X-Telegram-Init-Data'] = initData;
      if (getAdminSecret()) headers['X-Admin-Secret'] = getAdminSecret();

      const res = await fetch('/api/admin/export-csv', { headers });
      if (!res.ok) throw new Error('Export failed (admin access required)');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `airdrop_snapshot_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('CSV snapshot downloaded!', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createAdminTask({
        title: newTask.title,
        description: newTask.description,
        category: newTask.category,
        reward: Number(newTask.reward),
        actionUrl: newTask.actionUrl || undefined,
        verificationType: newTask.verificationType,
        targetValue: newTask.targetValue || undefined,
      });
      setOverview((prev) => (prev ? { ...prev, tasks: res.tasks } : prev));
      setNewTask({
        title: '',
        description: '',
        category: 'social',
        reward: 1000,
        actionUrl: '',
        verificationType: 'external_link',
        targetValue: '',
      });
      showToast('New quest published!', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleToggleTask = async (task: TaskItem) => {
    try {
      const res = await api.toggleAdminTask(task.id, !task.isActive);
      setOverview((prev) => (prev ? { ...prev, tasks: res.tasks } : prev));
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleDeleteTask = async (task: TaskItem) => {
    if (!window.confirm(`Delete quest "${task.title}"?`)) return;
    try {
      const res = await api.deleteAdminTask(task.id);
      setOverview((prev) => (prev ? { ...prev, tasks: res.tasks } : prev));
      showToast('Quest deleted.', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleAdjust = async (id: number, delta: number) => {
    const raw = window.prompt(`Amount of $${tokenSymbol} to credit/debit (e.g. 5000 or -1000):`, '5000');
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount === 0) {
      showToast('Invalid amount.', 'error');
      return;
    }
    try {
      const res = await api.adjustUserBalance(id, amount, 'Manual admin adjustment');
      await load(search);
      showToast(`Balance adjusted by ${amount}.`, 'success');
      void res;
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleBan = async (id: number, banned: boolean) => {
    try {
      await api.banUser(id, banned);
      await load(search);
      showToast(banned ? 'User flagged/banned.' : 'User reinstated.', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastText.trim() || broadcasting) return;
    if (!window.confirm('Send this announcement to all Telegram users?')) return;
    setBroadcasting(true);
    try {
      const res = await api.broadcastMessage(broadcastText.trim());
      showToast(
        `Broadcast done — sent: ${res.result.sent}, failed: ${res.result.failed}`,
        'success'
      );
      setBroadcastText('');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBroadcasting(false);
    }
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    try {
      const res = await api.updateAdminSettings(patch);
      setOverview((prev) => (prev ? { ...prev, settings: res.settings } : prev));
      showToast('Settings saved.', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  if (loading && !overview) {
    return (
      <div className="py-16 text-center text-xs text-slate-400">
        <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-400" />
        Loading admin control center...
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="space-y-4 pb-6">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-rose-300">
            <KeyRound className="h-4 w-4" /> Admin access required
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-200/80">{error}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Add your numeric Telegram ID to <code className="text-sky-300">ADMIN_IDS</code> in{' '}
            <code className="text-sky-300">.env</code>, or paste your{' '}
            <code className="text-sky-300">ADMIN_SECRET</code> below.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            ADMIN_SECRET override
          </label>
          <input
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="your-admin-secret"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-sky-500/60"
          />
          <button
            onClick={() => {
              setAdminSecret(secretInput.trim());
              void load('');
            }}
            className="w-full rounded-xl bg-sky-500 py-2.5 text-xs font-extrabold text-slate-950"
          >
            Unlock Admin Panel
          </button>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { stats, settings, botStatus, tasks, users } = overview;

  const statCards = [
    { label: 'Total Users', value: stats.totalUsers.toLocaleString(), icon: <Users className="h-4 w-4" />, color: 'text-sky-300' },
    { label: 'Real Telegram', value: stats.realUsers.toLocaleString(), icon: <Users className="h-4 w-4" />, color: 'text-indigo-300' },
    { label: 'TON Wallets', value: stats.connectedWallets.toLocaleString(), icon: <Wallet className="h-4 w-4" />, color: 'text-emerald-300' },
    { label: 'Claims Today', value: stats.claimedToday.toLocaleString(), icon: <BarChart3 className="h-4 w-4" />, color: 'text-amber-300' },
    { label: 'Tasks Done', value: stats.tasksCompleted.toLocaleString(), icon: <BarChart3 className="h-4 w-4" />, color: 'text-purple-300' },
    { label: 'Circulating', value: stats.circulatingBalance.toLocaleString(), icon: <BarChart3 className="h-4 w-4" />, color: 'text-rose-300' },
  ];

  const sections: Array<[AdminSection, string]> = [
    ['stats', 'Stats'],
    ['tasks', 'Quests'],
    ['users', 'Users'],
    ['broadcast', 'Broadcast'],
    ['settings', 'Settings'],
  ];

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-rose-500/25 bg-gradient-to-r from-rose-950/50 to-slate-900 p-3.5">
        <div>
          <h2 className="text-sm font-extrabold text-white">🛠️ Admin Control Center</h2>
          <p className="text-[11px] text-slate-400">
            Bot: {botStatus.configured ? (botStatus.running ? `🟢 @${botStatus.username}` : '🟡 token set, not polling') : '🔴 not configured'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => load(search)}
            className="rounded-lg bg-white/10 p-2 text-slate-200 hover:bg-white/20"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-2 text-[11px] font-bold text-slate-950"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {sections.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              section === key
                ? 'bg-white text-slate-950'
                : 'border border-white/10 bg-white/[0.04] text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'stats' && (
        <div className="grid grid-cols-2 gap-2">
          {statCards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${c.color}`}>
                {c.icon}
                {c.label}
              </div>
              <div className="mt-1.5 text-lg font-black text-white tabular-nums">{c.value}</div>
            </div>
          ))}
          <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Total Minted (lifetime)
            </div>
            <div className="mt-1 text-lg font-black text-white tabular-nums">
              {stats.totalMinted.toLocaleString()} ${tokenSymbol}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              Airdrop phase: {settings.airdropPhase} · Snapshot: {settings.snapshotDate}
            </div>
          </div>
        </div>
      )}

      {section === 'tasks' && (
        <div className="space-y-3">
          <form onSubmit={handleCreateTask} className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-white">
              <Plus className="h-3.5 w-3.5" /> Publish New Quest
            </h3>
            <input
              required
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="Title (e.g. Join our X / Twitter)"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
            />
            <input
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              placeholder="Short description"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newTask.category}
                onChange={(e) => setNewTask({ ...newTask, category: e.target.value as TaskCategory })}
                className="rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none"
              >
                <option value="social">Social</option>
                <option value="onchain">TON On-Chain</option>
                <option value="milestone">Milestone</option>
              </select>
              <input
                type="number"
                min={1}
                value={newTask.reward}
                onChange={(e) => setNewTask({ ...newTask, reward: Number(e.target.value) })}
                placeholder="Reward"
                className="rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none"
              />
            </div>
            <input
              value={newTask.actionUrl}
              onChange={(e) => setNewTask({ ...newTask, actionUrl: e.target.value })}
              placeholder="Action URL (https://t.me/... or https://x.com/...)"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newTask.verificationType}
                onChange={(e) =>
                  setNewTask({
                    ...newTask,
                    verificationType: e.target.value as TaskItem['verificationType'],
                  })
                }
                className="rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none"
              >
                <option value="external_link">External link</option>
                <option value="telegram_channel">Telegram channel</option>
                <option value="wallet_connect">Wallet connect</option>
                <option value="invite_count">Invite count</option>
                <option value="streak_days">Streak days</option>
              </select>
              <input
                value={newTask.targetValue}
                onChange={(e) => setNewTask({ ...newTask, targetValue: e.target.value })}
                placeholder="@channel or 3"
                className="rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-sky-500 py-2.5 text-xs font-extrabold text-slate-950"
            >
              Publish Quest
            </button>
          </form>

          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">{t.title}</div>
                  <div className="text-[10px] text-slate-400">
                    {t.category} · {t.verificationType} · +{t.reward.toLocaleString()} ${tokenSymbol}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => handleToggleTask(t)}
                    className={`rounded-lg px-2 py-1.5 text-[10px] font-bold ${
                      t.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-400'
                    }`}
                  >
                    {t.isActive ? 'ACTIVE' : 'OFF'}
                  </button>
                  <button
                    onClick={() => handleDeleteTask(t)}
                    className="rounded-lg bg-rose-500/15 p-1.5 text-rose-300 hover:bg-rose-500/25"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="space-y-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(search);
            }}
            className="flex gap-1.5"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, username or ID"
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-8 pr-3 text-xs text-white outline-none focus:border-sky-500/60"
              />
            </div>
            <button type="submit" className="rounded-xl bg-sky-500 px-3 text-xs font-bold text-slate-950">
              Find
            </button>
          </form>

          <div className="space-y-1.5">
            {users.map((u) => (
              <div key={u.telegram_id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate text-xs font-semibold text-white">
                      {u.first_name}
                      {u.wallet_address && <span title="Wallet linked">💎</span>}
                      {u.is_banned === 1 && (
                        <span className="rounded bg-rose-500/20 px-1 text-[9px] font-bold text-rose-300">
                          BANNED
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      ID {u.telegram_id} {u.username ? `· @${u.username}` : ''} · 🔥{u.daily_streak}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-bold text-sky-300 tabular-nums">
                      {u.balance.toLocaleString()}
                    </div>
                    <div className="text-[9px] text-slate-500">
                      earned {u.total_earned.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    onClick={() => handleAdjust(u.telegram_id, 1)}
                    className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-semibold text-slate-200"
                  >
                    Adjust balance
                  </button>
                  <button
                    onClick={() => handleBan(u.telegram_id, u.is_banned === 0)}
                    className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-rose-500/20 hover:text-rose-300"
                  >
                    {u.is_banned === 0 ? 'Ban / flag' : 'Unban'}
                  </button>
                  {u.wallet_address && (
                    <span className="truncate rounded-lg bg-emerald-500/10 px-2 py-1 font-mono text-[9px] text-emerald-300">
                      {u.wallet_address.slice(0, 10)}…
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'broadcast' && (
        <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-white">
            <Megaphone className="h-3.5 w-3.5" /> Telegram Broadcast
          </h3>
          <p className="text-[10px] leading-relaxed text-slate-400">
            Sends an HTML message from the bot to every Telegram user (demo/sandbox accounts
            excluded). Requires <code className="text-sky-300">BOT_TOKEN</code> in .env.
          </p>
          <textarea
            rows={5}
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="<b>Snapshot in 24h!</b> Claim your daily reward and connect your wallet."
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
          />
          <button
            onClick={handleBroadcast}
            disabled={broadcasting || !broadcastText.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 py-2.5 text-xs font-extrabold text-white disabled:opacity-50"
          >
            {broadcasting ? 'Broadcasting...' : 'Send to all users'}
          </button>
          {!botStatus.configured && (
            <p className="text-[10px] font-semibold text-amber-400">
              ⚠️ BOT_TOKEN not configured — broadcasts will fail.
            </p>
          )}
        </div>
      )}

      {section === 'settings' && (
        <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-white">
            <Settings2 className="h-3.5 w-3.5" /> Token & Referral Configuration
          </h3>
          {(
            [
              ['tokenName', 'Token Name'],
              ['tokenSymbol', 'Token Symbol'],
              ['airdropPhase', 'Airdrop Phase Label'],
              ['snapshotDate', 'Snapshot Date'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {label}
              </span>
              <input
                value={settings[key]}
                onChange={(e) =>
                  setOverview({ ...overview, settings: { ...settings, [key]: e.target.value } })
                }
                className="mt-0.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
              />
            </label>
          ))}
          {(
            [
              ['referralRewardRegular', 'Referral Bonus (Regular)'],
              ['referralRewardPremium', 'Referral Bonus (Premium)'],
              ['referralCommissionPct', 'Referral Commission (%)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {label}
              </span>
              <input
                type="number"
                value={settings[key]}
                onChange={(e) =>
                  setOverview({
                    ...overview,
                    settings: { ...settings, [key]: Number(e.target.value) },
                  })
                }
                className="mt-0.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/60"
              />
            </label>
          ))}
          <button
            onClick={() =>
              handleSaveSettings({
                tokenName: settings.tokenName,
                tokenSymbol: settings.tokenSymbol,
                airdropPhase: settings.airdropPhase,
                snapshotDate: settings.snapshotDate,
                referralRewardRegular: settings.referralRewardRegular,
                referralRewardPremium: settings.referralRewardPremium,
                referralCommissionPct: settings.referralCommissionPct,
              })
            }
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-slate-950"
          >
            Save Configuration
          </button>
        </div>
      )}

      <button
        onClick={() => {
          triggerHaptic('light');
          load(search);
        }}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 text-[11px] font-semibold text-slate-400"
      >
        Refresh data
      </button>
    </div>
  );
};

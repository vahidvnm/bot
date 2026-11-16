import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  FlaskConical,
  Rocket,
  Shield,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import type { UserStateResponse } from '../shared/types.js';
import { api, initTelegramWebApp, setDemoUserId, triggerHaptic } from './api.js';
import { HomeTab } from './components/HomeTab.js';
import { BoostsTab } from './components/BoostsTab.js';
import { TasksTab } from './components/TasksTab.js';
import { FriendsTab } from './components/FriendsTab.js';
import { WalletTab } from './components/WalletTab.js';
import { AdminTab } from './components/AdminTab.js';

type TabKey = 'mine' | 'boosts' | 'tasks' | 'friends' | 'wallet' | 'admin';

interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function App() {
  const [state, setState] = useState<UserStateResponse | null>(null);
  const [botStatus, setBotStatus] = useState<{
    configured: boolean;
    running: boolean;
    username: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('mine');
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const res = await api.getState();
      setState(res);
      if (res.botStatus) setBotStatus(res.botStatus);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    initTelegramWebApp();
    void loadState();
  }, [loadState]);

  // Deep-link support (?tab=wallet / ?tab=admin)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tab');
    if (
      requested &&
      ['mine', 'boosts', 'tasks', 'friends', 'wallet', 'admin'].includes(requested)
    ) {
      setTab(requested as TabKey);
    }
  }, []);

  // Light polling to keep balances fresh across devices
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadState();
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [loadState]);

  const handleTabChange = (next: TabKey) => {
    triggerHaptic('light');
    setTab(next);
  };

  if (error && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070B14] p-6">
        <div className="w-full max-w-sm rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <X className="mx-auto h-8 w-8 text-rose-400" />
          <h1 className="mt-3 text-base font-bold text-white">Could not load airdrop</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{error}</p>
          <button
            onClick={() => void loadState()}
            className="mt-4 w-full rounded-xl bg-sky-500 py-2.5 text-xs font-extrabold text-slate-950"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#070B14]">
        <img src="/logo.svg" alt="Loading" className="h-16 w-16 animate-pulse" />
        <div className="text-xs font-semibold tracking-widest text-sky-400 uppercase">
          Syncing airdrop…
        </div>
      </div>
    );
  }

  const isDemo = state.authMode === 'demo';
  const symbol = state.settings.tokenSymbol;

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'mine', label: 'Mine', icon: <Rocket className="h-5 w-5" /> },
    { key: 'boosts', label: 'Boosts', icon: <Zap className="h-5 w-5" /> },
    { key: 'tasks', label: 'Quests', icon: <CheckCircle2 className="h-5 w-5" /> },
    { key: 'friends', label: 'Squad', icon: <Users className="h-5 w-5" /> },
    { key: 'wallet', label: 'Wallet', icon: <Wallet className="h-5 w-5" /> },
  ];
  if (state.user.isAdmin) {
    tabs.push({ key: 'admin', label: 'Admin', icon: <Shield className="h-5 w-5" /> });
  }

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-500/15 blur-[90px]" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-purple-600/10 blur-[90px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col">
        {/* Demo / Sandbox banner */}
        {isDemo && !bannerDismissed && (
          <div className="mx-3 mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1 text-[10px] leading-relaxed text-amber-100/90">
              <b className="text-amber-300">Demo Sandbox mode.</b>{' '}
              {botStatus?.configured
                ? 'Open this Mini App from Telegram to use a real account.'
                : 'BOT_TOKEN is not set yet, so you are playing with a test account. All game features work — add BOT_TOKEN in .env for real Telegram auth.'}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    setDemoUserId(777001);
                    void loadState();
                    showToast('Switched to Demo Pioneer', 'success');
                  }}
                  className="rounded-lg bg-amber-400/20 px-2 py-1 text-[10px] font-bold text-amber-200"
                >
                  Pioneer (admin)
                </button>
                <button
                  onClick={() => {
                    setDemoUserId(777002);
                    void loadState();
                    showToast('Switched to Invited Friend', 'success');
                  }}
                  className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-slate-200"
                >
                  Regular user
                </button>
              </div>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="shrink-0 rounded-lg p-1 text-amber-300/70 hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 px-3 pt-3">
          {tab === 'mine' && (
            <HomeTab
              data={state}
              onStateUpdate={setState}
              onNavigateTab={(t) => setTab(t)}
              showToast={showToast}
            />
          )}
          {tab === 'boosts' && (
            <BoostsTab data={state} onStateUpdate={setState} showToast={showToast} />
          )}
          {tab === 'tasks' && (
            <TasksTab
              data={state}
              onStateUpdate={setState}
              onNavigateWallet={() => setTab('wallet')}
              showToast={showToast}
            />
          )}
          {tab === 'friends' && (
            <FriendsTab data={state} onStateUpdate={setState} showToast={showToast} />
          )}
          {tab === 'wallet' && (
            <WalletTab data={state} onStateUpdate={setState} showToast={showToast} />
          )}
          {tab === 'admin' && state.user.isAdmin && (
            <AdminTab showToast={showToast} tokenSymbol={symbol} />
          )}
        </main>

        {/* Fixed bottom tab bar */}
        <nav className="sticky bottom-0 z-40 mt-2 border-t border-white/10 bg-[#070B14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="flex items-center justify-around px-1 py-1.5">
            {tabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => handleTabChange(t.key)}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition ${
                    active ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${
                      active
                        ? 'bg-sky-500/15 text-sky-400 shadow-[0_0_16px_rgba(14,165,233,0.25)]'
                        : ''
                    }`}
                  >
                    {t.icon}
                  </div>
                  <span className={`text-[9px] font-bold ${active ? 'text-sky-300' : ''}`}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Toast stack */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-1.5 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-sm rounded-xl border px-3.5 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur-lg ${
              t.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100'
                : 'border-rose-500/40 bg-rose-950/90 text-rose-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

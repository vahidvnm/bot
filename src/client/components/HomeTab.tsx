import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Flame,
  Pickaxe,
  Sparkles,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  DAILY_STREAK_REWARDS,
  ENERGY_REGEN_PER_SEC,
  UserStateResponse,
  getUserLeague,
} from '../../shared/types.js';
import { shortenAddress } from '../../shared/ton.js';
import { api, triggerHaptic } from '../api.js';

interface FloatingParticle {
  id: number;
  x: number;
  y: number;
  value: number;
}

interface HomeTabProps {
  data: UserStateResponse;
  onStateUpdate: (next: UserStateResponse) => void;
  onNavigateTab: (tab: 'boosts' | 'wallet' | 'tasks' | 'friends') => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

function formatCountdown(targetIso: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(
    2,
    '0'
  )}`;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  data,
  onStateUpdate,
  onNavigateTab,
  showToast,
}) => {
  const { user, settings } = data;
  const league = getUserLeague(user.totalEarned);

  const [localBalance, setLocalBalance] = useState(user.balance);
  const [localEnergy, setLocalEnergy] = useState(user.energy);
  const [nowMs, setNowMs] = useState(Date.now());
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const [orbPressed, setOrbPressed] = useState(false);
  const [showDailyModal, setShowDailyModal] = useState(false);
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [claimingMining, setClaimingMining] = useState(false);

  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const particleIdRef = useRef(1);

  // Sync local state when server state refreshes (unless mid-tap batch)
  useEffect(() => {
    if (pendingTapsRef.current === 0) {
      setLocalBalance(user.balance);
      setLocalEnergy(user.energy);
    }
  }, [user.balance, user.energy]);

  // 1-second ticker for Energy regeneration, Mining counter & Daily Countdown
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
      setLocalEnergy((prev) => Math.min(user.maxEnergy, prev + ENERGY_REGEN_PER_SEC));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [user.maxEnergy]);

  // Live interpolated passive mining pending value
  const miningElapsedHours = Math.max(
    0,
    (nowMs - new Date(user.miningStartedAt).getTime()) / 3_600_000
  );
  const liveMiningExact = Math.min(
    user.miningCapacity,
    miningElapsedHours * user.miningRatePerHour
  );
  const liveMiningInt = Math.floor(liveMiningExact);
  const miningFillPct =
    user.miningCapacity > 0
      ? Math.min(100, (liveMiningExact / user.miningCapacity) * 100)
      : 0;

  const flushTaps = async () => {
    const count = pendingTapsRef.current;
    if (count <= 0) return;
    pendingTapsRef.current = 0;
    try {
      const res = await api.sendTaps(count);
      onStateUpdate(res.state);
    } catch {
      // ignore transient network hiccup
    }
  };

  const handleOrbPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (localEnergy < user.tapPower) {
      triggerHaptic('error');
      showToast('Out of tap energy! Wait a few seconds or use a Free Refill in Boosts.', 'error');
      return;
    }

    triggerHaptic('light');
    setOrbPressed(true);
    window.setTimeout(() => setOrbPressed(false), 110);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pid = particleIdRef.current++;
    setParticles((prev) => [...prev.slice(-14), { id: pid, x, y, value: user.tapPower }]);
    window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== pid));
    }, 800);

    setLocalBalance((b) => b + user.tapPower);
    setLocalEnergy((en) => Math.max(0, en - user.tapPower));
    pendingTapsRef.current += 1;

    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      void flushTaps();
    }, 450);
  };

  const handleClaimDaily = async () => {
    if (claimingDaily) return;
    setClaimingDaily(true);
    try {
      const res = await api.claimDaily();
      triggerHaptic('success');
      onStateUpdate(res.state);
      showToast(
        `🎉 Daily Streak Claimed! +${res.claim.reward.toLocaleString()} $${settings.tokenSymbol}`,
        'success'
      );
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setClaimingDaily(false);
    }
  };

  const handleHarvestMining = async () => {
    if (claimingMining) return;
    setClaimingMining(true);
    try {
      const res = await api.claimMining();
      triggerHaptic('success');
      onStateUpdate(res.state);
      showToast(
        `⛏️ Harvested +${res.harvest.claimed.toLocaleString()} $${settings.tokenSymbol} from vault!`,
        'success'
      );
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setClaimingMining(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Top Explorer & Wallet Bar */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-bold shadow-lg shadow-sky-500/20">
            {league.current.badge}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-white">
                {user.firstName}
              </span>
              {user.isPremium && (
                <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  PRO
                </span>
              )}
            </div>
            <button
              onClick={() => onNavigateTab('friends')}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-300"
            >
              <Trophy className="h-3 w-3 text-amber-400" />
              <span>{league.current.name}</span>
              <span className="text-slate-600">•</span>
              <span className="text-sky-400 font-medium">#{user.rank}</span>
            </button>
          </div>
        </div>

        <button
          onClick={() => onNavigateTab('wallet')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            user.walletAddress
              ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
              : 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25'
          }`}
        >
          <Wallet className="h-3.5 w-3.5" />
          <span>
            {user.walletAddress ? shortenAddress(user.walletAddress, 4) : 'Connect TON'}
          </span>
        </button>
      </div>

      {/* Quick Action Cards: Daily Check-In + Mining Rate */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => setShowDailyModal(true)}
          className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition ${
            user.canClaimDaily
              ? 'border-amber-400/40 bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent shadow-lg shadow-amber-500/10'
              : 'border-white/10 bg-white/[0.03]'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <Calendar className="h-4 w-4" />
            </div>
            {user.canClaimDaily ? (
              <span className="animate-pulse rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-950">
                Claim!
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-xs font-semibold text-orange-300">
                <Flame className="h-3.5 w-3.5 fill-orange-400 text-orange-400" />
                {user.dailyStreak}d
              </span>
            )}
          </div>
          <div className="mt-2 text-xs font-bold text-white">Daily Check-In</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {user.canClaimDaily
              ? `Day ${user.nextStreakDay}: +${user.nextDailyReward.toLocaleString()} $${settings.tokenSymbol}`
              : `Next in ${formatCountdown(user.nextDailyResetIso, nowMs)}`}
          </div>
        </button>

        <button
          onClick={() => onNavigateTab('boosts')}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-sky-500/30 hover:bg-white/[0.05]"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
              Lv.{user.levels.mining_rig}
            </span>
          </div>
          <div className="mt-2 text-xs font-bold text-white">Profit Per Hour</div>
          <div className="mt-0.5 text-[11px] font-semibold text-sky-300">
            +{user.miningRatePerHour.toLocaleString()} ${settings.tokenSymbol}/hr
          </div>
        </button>
      </div>

      {/* Main Token Balance Display */}
      <div className="text-center pt-1">
        <div className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
          {settings.airdropPhase}
        </div>
        <div className="mt-1 flex items-center justify-center gap-2.5">
          <img src="/logo.svg" alt="Token" className="h-9 w-9 drop-shadow-[0_0_12px_rgba(56,189,248,0.5)]" />
          <span className="text-4xl font-black tracking-tight text-white tabular-nums">
            {localBalance.toLocaleString()}
          </span>
          <span className="rounded-lg bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-300">
            ${settings.tokenSymbol}
          </span>
        </div>

        {/* League Progress Bar */}
        {league.next && (
          <div className="mx-auto mt-2.5 max-w-xs">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>{league.current.name}</span>
              <span>
                Next: {league.next.badge} {league.next.name} ({league.progressPct}%)
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400 transition-all duration-500"
                style={{ width: `${league.progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Interactive Quantum Tap-to-Earn Orb */}
      <div className="relative flex flex-col items-center justify-center py-2">
        <div className="relative">
          {/* Ambient Glow */}
          <div className="pointer-events-none absolute -inset-4 rounded-full bg-gradient-to-tr from-sky-500/25 via-blue-600/20 to-purple-600/25 blur-2xl" />

          <button
            type="button"
            onPointerDown={handleOrbPointerDown}
            className={`relative flex h-52 w-52 items-center justify-center rounded-full border-4 border-sky-400/30 bg-gradient-to-b from-slate-800 via-[#0D172A] to-[#070B14] shadow-[0_0_50px_rgba(14,165,233,0.28),inset_0_4px_24px_rgba(56,189,248,0.35)] transition-transform duration-100 active:scale-95 ${
              orbPressed ? 'scale-95' : 'scale-100'
            }`}
          >
            <div className="pointer-events-none flex h-40 w-40 flex-col items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sky-500/20 via-indigo-600/15 to-purple-700/20">
              <img
                src="/logo.svg"
                alt="Tap Orb"
                className="h-24 w-24 drop-shadow-[0_8px_24px_rgba(56,189,248,0.55)]"
              />
              <span className="mt-1 text-[11px] font-bold tracking-wider text-sky-300/90 uppercase">
                Tap +{user.tapPower}
              </span>
            </div>

            {/* Floating +X Tap Particles */}
            {particles.map((p) => (
              <span
                key={p.id}
                style={{ left: p.x, top: p.y }}
                className="animate-float-up absolute z-20 select-none text-2xl font-black text-sky-300 drop-shadow-[0_2px_8px_rgba(14,165,233,0.9)]"
              >
                +{p.value}
              </span>
            ))}
          </button>
        </div>

        {/* Energy Bar */}
        <div className="mt-4 w-full max-w-xs">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 font-semibold text-amber-300">
              <Zap className="h-3.5 w-3.5 fill-amber-300" />
              <span className="tabular-nums">
                {localEnergy} / {user.maxEnergy}
              </span>
            </span>
            <button
              onClick={() => onNavigateTab('boosts')}
              className="text-xs font-semibold text-sky-400 hover:text-sky-300"
            >
              ⚡ Boosts & Refill →
            </button>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-sky-400 transition-all duration-300"
              style={{
                width: `${Math.min(100, (localEnergy / user.maxEnergy) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Passive 24/7 Mining Storage Vault */}
      <div className="rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-950/50 via-slate-900/80 to-indigo-950/40 p-4 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
              <Pickaxe className="h-3.5 w-3.5" />
              <span>Passive Mining Vault ({user.storageHours}h Tank)</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-black tabular-nums text-white">
                {liveMiningExact.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">
                / {user.miningCapacity.toLocaleString()} ${settings.tokenSymbol}
              </span>
            </div>
          </div>

          <button
            onClick={handleHarvestMining}
            disabled={claimingMining || liveMiningInt < 1}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
              liveMiningInt >= 1
                ? 'bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 shadow-lg shadow-emerald-500/25 hover:brightness-110 active:scale-95'
                : 'cursor-not-allowed bg-white/10 text-slate-500'
            }`}
          >
            {claimingMining
              ? 'Claiming...'
              : liveMiningInt >= 1
              ? `Harvest +${liveMiningInt.toLocaleString()}`
              : 'Mining...'}
          </button>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400 transition-all duration-500"
            style={{ width: `${miningFillPct}%` }}
          />
        </div>
      </div>

      {/* 7-Day Escalating Daily Streak Modal */}
      {showDailyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0D1425] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Flame className="h-5 w-5 fill-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Daily Streak Rewards</h3>
                  <p className="text-xs text-slate-400">
                    Claim every UTC day to multiply your ${settings.tokenSymbol} drop!
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDailyModal(false)}
                className="rounded-full bg-white/10 p-1.5 text-slate-300 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {DAILY_STREAK_REWARDS.map((amt, idx) => {
                const dayNum = idx + 1;
                const completedInCycle = !user.canClaimDaily
                  ? ((user.dailyStreak - 1) % 7) + 1
                  : user.nextStreakDay - 1;
                const isDone = dayNum <= completedInCycle;
                const isCurrentTarget = user.canClaimDaily && dayNum === user.nextStreakDay;

                return (
                  <div
                    key={dayNum}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-2.5 text-center ${
                      dayNum === 7 ? 'col-span-2' : ''
                    } ${
                      isCurrentTarget
                        ? 'border-amber-400 bg-amber-500/20 shadow-md shadow-amber-500/20'
                        : isDone
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase text-slate-400">
                      Day {dayNum}
                    </span>
                    <span className="my-1 text-base">
                      {isDone ? '✅' : dayNum === 7 ? '💎' : '🎁'}
                    </span>
                    <span className="text-xs font-extrabold text-white">
                      +{amt.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              {user.canClaimDaily ? (
                <button
                  onClick={handleClaimDaily}
                  disabled={claimingDaily}
                  className="w-full rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/25 transition hover:brightness-110 active:scale-[0.99]"
                >
                  {claimingDaily
                    ? 'Claiming...'
                    : `🎁 Claim Day ${user.nextStreakDay} (+${user.nextDailyReward.toLocaleString()} $${settings.tokenSymbol})`}
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-3 text-xs font-semibold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Claimed today! Next reward in {formatCountdown(user.nextDailyResetIso, nowMs)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

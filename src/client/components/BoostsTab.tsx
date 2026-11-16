import React, { useState } from 'react';
import { BatteryCharging, Clock, Cpu, Hand, Zap } from 'lucide-react';
import {
  BOOST_CATALOG,
  BoostType,
  MAX_DAILY_ENERGY_REFILLS,
  UserStateResponse,
  getBoostCost,
  getMaxEnergy,
  getMiningRatePerHour,
  getStorageHours,
  getTapPower,
} from '../../shared/types.js';
import { api, triggerHaptic } from '../api.js';

interface BoostsTabProps {
  data: UserStateResponse;
  onStateUpdate: (next: UserStateResponse) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export const BoostsTab: React.FC<BoostsTabProps> = ({
  data,
  onStateUpdate,
  showToast,
}) => {
  const { user, settings } = data;
  const [busyBoost, setBusyBoost] = useState<string | null>(null);

  const handleRefill = async () => {
    if (busyBoost) return;
    setBusyBoost('refill');
    try {
      const res = await api.refillEnergy();
      triggerHaptic('success');
      onStateUpdate(res.state);
      showToast('⚡ Energy restored to 100%!', 'success');
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setBusyBoost(null);
    }
  };

  const handleUpgrade = async (boostType: BoostType) => {
    if (busyBoost) return;
    setBusyBoost(boostType);
    try {
      const res = await api.upgradeBoost(boostType);
      triggerHaptic('success');
      onStateUpdate(res.state);
      showToast(
        `🚀 Upgraded ${BOOST_CATALOG[boostType].title} to Level ${res.upgrade.newLevel}!`,
        'success'
      );
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setBusyBoost(null);
    }
  };

  const boostCards: Array<{
    type: BoostType;
    icon: React.ReactNode;
    accent: string;
    currentLevel: number;
    previewText: string;
  }> = [
    {
      type: 'mining_rig',
      icon: <Cpu className="h-5 w-5 text-sky-300" />,
      accent: 'from-sky-500/20 to-blue-600/10',
      currentLevel: user.levels.mining_rig,
      previewText: `${getMiningRatePerHour(user.levels.mining_rig)}/hr → ${getMiningRatePerHour(
        user.levels.mining_rig + 1
      )}/hr`,
    },
    {
      type: 'storage_tank',
      icon: <Clock className="h-5 w-5 text-emerald-300" />,
      accent: 'from-emerald-500/20 to-teal-600/10',
      currentLevel: user.levels.storage_tank,
      previewText: `${getStorageHours(user.levels.storage_tank)}h tank → ${getStorageHours(
        user.levels.storage_tank + 1
      )}h tank`,
    },
    {
      type: 'multitap',
      icon: <Hand className="h-5 w-5 text-purple-300" />,
      accent: 'from-purple-500/20 to-indigo-600/10',
      currentLevel: user.levels.multitap,
      previewText: `+${getTapPower(user.levels.multitap)}/tap → +${getTapPower(
        user.levels.multitap + 1
      )}/tap`,
    },
    {
      type: 'energy_limit',
      icon: <BatteryCharging className="h-5 w-5 text-amber-300" />,
      accent: 'from-amber-500/20 to-orange-600/10',
      currentLevel: user.levels.energy_limit,
      previewText: `${getMaxEnergy(user.levels.energy_limit)} max → ${getMaxEnergy(
        user.levels.energy_limit + 1
      )} max`,
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      {/* Header Balance Summary */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
        <div className="text-xs text-slate-400">Available Upgrade Balance</div>
        <div className="mt-1 flex items-center justify-center gap-2">
          <img src="/logo.svg" alt="Token" className="h-6 w-6" />
          <span className="text-2xl font-black text-white tabular-nums">
            {user.balance.toLocaleString()}
          </span>
          <span className="text-xs font-bold text-sky-400">${settings.tokenSymbol}</span>
        </div>
      </div>

      {/* Free Daily Boosters */}
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Daily Free Booster
        </h3>
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/15 via-orange-500/5 to-transparent p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <Zap className="h-6 w-6 fill-amber-300" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Full Energy Tank</div>
              <div className="text-xs text-slate-400">
                {user.dailyRefillsLeft} / {MAX_DAILY_ENERGY_REFILLS} free refills left today
              </div>
            </div>
          </div>
          <button
            onClick={handleRefill}
            disabled={busyBoost !== null || user.dailyRefillsLeft <= 0}
            className={`rounded-xl px-4 py-2 text-xs font-extrabold transition ${
              user.dailyRefillsLeft > 0
                ? 'bg-amber-400 text-slate-950 hover:brightness-110 active:scale-95'
                : 'cursor-not-allowed bg-white/10 text-slate-500'
            }`}
          >
            {busyBoost === 'refill' ? '...' : user.dailyRefillsLeft > 0 ? 'FREE' : 'Used'}
          </button>
        </div>
      </div>

      {/* Permanent Upgrades */}
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Permanent Upgrades
        </h3>
        <div className="space-y-2.5">
          {boostCards.map((card) => {
            const def = BOOST_CATALOG[card.type];
            const isMax = card.currentLevel >= def.maxLevel;
            const cost = getBoostCost(card.type, card.currentLevel);
            const canAfford = user.balance >= cost;

            return (
              <div
                key={card.type}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${card.accent} border border-white/10`}
                  >
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-white">
                        {def.title}
                      </span>
                      <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                        Lv.{card.currentLevel}/{def.maxLevel}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">{def.description}</div>
                    {!isMax && (
                      <div className="mt-1 text-[11px] font-semibold text-sky-300">
                        {card.previewText}
                      </div>
                    )}
                  </div>
                </div>

                {isMax ? (
                  <span className="shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300">
                    MAX
                  </span>
                ) : (
                  <button
                    onClick={() => handleUpgrade(card.type)}
                    disabled={busyBoost !== null || !canAfford}
                    className={`shrink-0 rounded-xl px-3.5 py-2.5 text-right text-xs font-extrabold transition ${
                      canAfford
                        ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20 hover:brightness-110 active:scale-95'
                        : 'cursor-not-allowed bg-white/10 text-slate-500'
                    }`}
                  >
                    <div>{busyBoost === card.type ? '...' : cost.toLocaleString()}</div>
                    <div className="text-[10px] font-medium opacity-80">
                      ${settings.tokenSymbol}
                    </div>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

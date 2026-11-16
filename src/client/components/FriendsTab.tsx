import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Gift,
  Share2,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LeaderboardEntry, ReferralFriend, UserStateResponse } from '../../shared/types.js';
import { getUserLeague } from '../../shared/types.js';
import { api, openExternalOrTelegramLink, triggerHaptic } from '../api.js';

interface FriendsTabProps {
  data: UserStateResponse;
  onStateUpdate: (next: UserStateResponse) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export const FriendsTab: React.FC<FriendsTabProps> = ({
  data,
  onStateUpdate,
  showToast,
}) => {
  const { user, settings } = data;
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<ReferralFriend[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [simulating, setSimulating] = useState(false);

  const loadData = () => {
    api.getReferrals().then((r) => setFriends(r.referrals)).catch(() => {});
    api.getLeaderboard().then((r) => setLeaderboard(r.leaderboard)).catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(user.referralLink);
      setCopied(true);
      triggerHaptic('success');
      showToast('Invite link copied to clipboard!', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy failed. Long-press the link to copy manually.', 'error');
    }
  };

  const handleShare = () => {
    const text = encodeURIComponent(
      `🚀 Join me on the ${settings.tokenName} ($${settings.tokenSymbol}) TON Airdrop! We both get a welcome bonus when you start mining with my link:`
    );
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
      user.referralLink
    )}&text=${text}`;
    openExternalOrTelegramLink(shareUrl);
  };

  const handleSimulate = async () => {
    if (simulating) return;
    setSimulating(true);
    try {
      await api.simulateReferralJoin(user.telegramId);
      const fresh = await api.getState();
      onStateUpdate(fresh);
      loadData();
      triggerHaptic('success');
      showToast('A test friend joined via your link! Referral bonus credited. 🎉', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSimulating(false);
    }
  };

  const myEntry = leaderboard.find((e) => e.telegramId === user.telegramId);

  return (
    <div className="space-y-4 pb-6">
      {/* Referral Hero Card */}
      <div className="overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/50 via-slate-900 to-indigo-950/60 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/25 text-purple-300">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white">Invite Squad, Earn TON</h2>
            <p className="text-[11px] text-slate-300">
              {settings.referralCommissionPct}% lifetime commission on every friend's claim
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-2.5 text-center">
            <div className="text-lg font-black text-white tabular-nums">
              {user.referralsCount}
            </div>
            <div className="text-[10px] font-medium text-slate-400">Friends</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-2.5 text-center">
            <div className="text-lg font-black text-emerald-300 tabular-nums">
              {user.referralEarnings.toLocaleString()}
            </div>
            <div className="text-[10px] font-medium text-slate-400">Earned</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-2.5 text-center">
            <div className="text-lg font-black text-amber-300 tabular-nums">
              {settings.referralRewardRegular.toLocaleString()}
            </div>
            <div className="text-[10px] font-medium text-slate-400">Per Friend</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 p-1.5 pl-3">
          <Gift className="h-4 w-4 shrink-0 text-purple-300" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
            {user.referralLink}
          </span>
          <button
            onClick={handleCopy}
            className="shrink-0 rounded-lg bg-white/10 p-2 text-slate-200 transition hover:bg-white/20 active:scale-95"
            title="Copy link"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        <button
          onClick={handleShare}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-purple-500/25 transition hover:brightness-110 active:scale-[0.99]"
        >
          <Share2 className="h-4 w-4" />
          Share Invite Link
        </button>

        <button
          onClick={handleSimulate}
          disabled={simulating}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {simulating ? 'Simulating friend join...' : '🧪 Simulate a Friend Joining (Sandbox Test)'}
        </button>
      </div>

      {/* My Friends List */}
      <div>
        <h3 className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
          <span>My Squad ({friends.length})</span>
        </h3>
        {friends.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-slate-500" />
            <p className="mt-2 text-xs font-semibold text-slate-300">No friends onboarded yet</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Share your link — build your squad and earn passive commission forever.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => (
              <div
                key={f.telegramId}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-indigo-600/40 text-xs font-bold text-white">
                    {f.firstName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate text-xs font-semibold text-white">
                      {f.firstName}
                      {f.isPremium && <span className="text-amber-400">⭐️</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {f.username ? `@${f.username}` : 'Pioneer'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-emerald-300 tabular-nums">
                    +{Math.round(f.totalEarned * (settings.referralCommissionPct / 100)).toLocaleString()}
                  </div>
                  <div className="text-[9px] text-slate-500">your cut</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
          <Crown className="h-3.5 w-3.5 text-amber-400" />
          Top Airdrop Hunters
        </h3>

        {myEntry && (
          <div className="mb-2 flex items-center justify-between rounded-2xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/25 text-xs font-black text-sky-200">
                {myEntry.rank}
              </span>
              <div>
                <div className="text-xs font-bold text-white">You</div>
                <div className="text-[10px] text-sky-300">
                  {getUserLeague(myEntry.totalEarned).current.badge}{' '}
                  {getUserLeague(myEntry.totalEarned).current.name}
                </div>
              </div>
            </div>
            <div className="text-sm font-black text-white tabular-nums">
              {myEntry.totalEarned.toLocaleString()}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {leaderboard.slice(0, 15).map((entry) => {
            const medals = ['🥇', '🥈', '🥉'];
            const isMe = entry.telegramId === user.telegramId;
            return (
              <div
                key={entry.telegramId}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                  isMe
                    ? 'border-sky-500/30 bg-sky-500/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 shrink-0 text-center text-xs font-black text-slate-300">
                    {medals[entry.rank - 1] || entry.rank}
                  </span>
                  <span className="truncate text-xs font-semibold text-white">
                    {entry.firstName}
                    {entry.walletConnected && <span className="ml-1">💎</span>}
                  </span>
                </div>
                <span className="shrink-0 text-xs font-bold text-slate-300 tabular-nums">
                  {entry.totalEarned.toLocaleString()}
                </span>
              </div>
            );
          })}
          {leaderboard.length === 0 && (
            <div className="py-4 text-center text-[11px] text-slate-500">
              Leaderboard is warming up...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

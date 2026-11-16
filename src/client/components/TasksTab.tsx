import React, { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ExternalLink,
  Globe,
  Send,
  Wallet,
} from 'lucide-react';
import type { TaskCategory, TaskItem, UserStateResponse } from '../../shared/types.js';
import { api, openExternalOrTelegramLink, triggerHaptic } from '../api.js';

interface TasksTabProps {
  data: UserStateResponse;
  onStateUpdate: (next: UserStateResponse) => void;
  onNavigateWallet: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export const TasksTab: React.FC<TasksTabProps> = ({
  data,
  onStateUpdate,
  onNavigateWallet,
  showToast,
}) => {
  const { settings } = data;
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TaskCategory>('all');
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [openedLinks, setOpenedLinks] = useState<Record<number, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('opened_task_links') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    api
      .getTasks()
      .then((res) => setTasks(res.tasks))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const markLinkOpened = (taskId: number) => {
    const next = { ...openedLinks, [taskId]: true };
    setOpenedLinks(next);
    localStorage.setItem('opened_task_links', JSON.stringify(next));
  };

  const handleTaskAction = async (task: TaskItem) => {
    if (task.completed || claimingId !== null) return;

    // If task has an external/Telegram link and hasn't been visited yet, open link first!
    if (task.actionUrl && !openedLinks[task.id]) {
      markLinkOpened(task.id);
      openExternalOrTelegramLink(task.actionUrl);
      showToast('Opened link! Return here and tap Verify to claim your reward.', 'success');
      return;
    }

    if (task.verificationType === 'wallet_connect' && !data.user.walletAddress) {
      onNavigateWallet();
      showToast('Connect your TON wallet first to claim this quest!', 'error');
      return;
    }

    setClaimingId(task.id);
    try {
      const res = await api.claimTask(task.id);
      triggerHaptic('success');
      setTasks(res.tasks);
      onStateUpdate(res.state);
      showToast(
        `🎉 Quest Completed! +${res.claimed.reward.toLocaleString()} $${settings.tokenSymbol}`,
        'success'
      );
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setClaimingId(null);
    }
  };

  const filteredTasks =
    filter === 'all' ? tasks : tasks.filter((t) => t.category === filter);

  const completedCount = tasks.filter((t) => t.completed).length;

  const getTaskIcon = (task: TaskItem) => {
    if (task.verificationType === 'telegram_channel') {
      return <Send className="h-5 w-5 text-sky-400" />;
    }
    if (task.verificationType === 'wallet_connect') {
      return <Wallet className="h-5 w-5 text-emerald-400" />;
    }
    if (task.category === 'milestone') {
      return <Award className="h-5 w-5 text-amber-400" />;
    }
    return <Globe className="h-5 w-5 text-indigo-400" />;
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/60 via-slate-900 to-sky-950/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-white">Earn Bonus Tokens</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Complete social, TON wallet & squad quests for instant drops.
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-1.5 text-center">
            <div className="text-sm font-black text-sky-300">
              {completedCount}/{tasks.length}
            </div>
            <div className="text-[10px] text-slate-400">Done</div>
          </div>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {(
          [
            ['all', 'All Quests'],
            ['social', 'Social'],
            ['onchain', 'TON On-Chain'],
            ['milestone', 'Milestones'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              filter === key
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/25'
                : 'border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Task List */}
      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400">Loading quests...</div>
      ) : (
        <div className="space-y-2.5">
          {filteredTasks.map((task) => {
            const needsOpenFirst = Boolean(task.actionUrl && !openedLinks[task.id]);

            return (
              <div
                key={task.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition ${
                  task.completed
                    ? 'border-emerald-500/20 bg-emerald-500/[0.05] opacity-80'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                    {getTaskIcon(task)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">
                      {task.title}
                    </div>
                    <div className="line-clamp-1 text-xs text-slate-400">
                      {task.description}
                    </div>
                    <div className="mt-1 text-xs font-extrabold text-amber-300">
                      +{task.reward.toLocaleString()} ${settings.tokenSymbol}
                    </div>
                  </div>
                </div>

                {task.completed ? (
                  <div className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Done</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleTaskAction(task)}
                    disabled={claimingId !== null}
                    className={`flex shrink-0 items-center gap-1 rounded-xl px-3.5 py-2.5 text-xs font-extrabold transition active:scale-95 ${
                      needsOpenFirst
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25'
                    }`}
                  >
                    {claimingId === task.id ? (
                      <span>Checking...</span>
                    ) : needsOpenFirst ? (
                      <>
                        <span>Open</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      <span>Verify</span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

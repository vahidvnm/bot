import type {
  AppSettings,
  BoostType,
  LeaderboardEntry,
  ReferralFriend,
  TaskItem,
  TransactionRecord,
  UserStateResponse,
} from '../shared/types.js';

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  try {
    tg.ready?.();
    tg.expand?.();
    tg.setHeaderColor?.('#070B14');
    tg.setBackgroundColor?.('#070B14');
  } catch {
    // ignore older clients
  }
}

export function triggerHaptic(
  type: 'light' | 'medium' | 'success' | 'error' = 'light'
): void {
  const hf = window.Telegram?.WebApp?.HapticFeedback;
  if (!hf) return;
  try {
    if (type === 'success' || type === 'error') {
      hf.notificationOccurred?.(type);
    } else {
      hf.impactOccurred?.(type);
    }
  } catch {
    // ignore
  }
}

export function openExternalOrTelegramLink(url: string): void {
  const tg = window.Telegram?.WebApp;
  if (url.startsWith('https://t.me/') && tg?.openTelegramLink) {
    tg.openTelegramLink(url);
    return;
  }
  if (tg?.openLink) {
    tg.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

let currentDemoUserId = Number(localStorage.getItem('demo_user_id') || '777001');
let adminSecretKey = localStorage.getItem('admin_secret_key') || '';

export function getDemoUserId(): number {
  return currentDemoUserId;
}

export function setDemoUserId(id: number): void {
  currentDemoUserId = id;
  localStorage.setItem('demo_user_id', String(id));
}

export function setAdminSecret(secret: string): void {
  adminSecretKey = secret;
  localStorage.setItem('admin_secret_key', secret);
}

export function getAdminSecret(): string {
  return adminSecretKey;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const initData = window.Telegram?.WebApp?.initData || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Demo-User-Id': String(currentDemoUserId),
    ...extraHeaders,
  };
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (adminSecretKey) {
    headers['X-Admin-Secret'] = adminSecretKey;
  }

  const res = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface StateWithBotResponse extends UserStateResponse {
  botStatus?: {
    configured: boolean;
    running: boolean;
    username: string;
    webAppUrl: string | null;
  };
}

export const api = {
  getState: () => request<StateWithBotResponse>('/api/state'),

  claimDaily: () =>
    request<{
      claim: { reward: number; newStreak: number; nextResetIso: string };
      state: UserStateResponse;
    }>('/api/claim-daily', { method: 'POST' }),

  claimMining: () =>
    request<{
      harvest: { claimed: number };
      state: UserStateResponse;
    }>('/api/claim-mining', { method: 'POST' }),

  sendTaps: (taps: number) =>
    request<{
      result: { acceptedTaps: number; earned: number; remainingEnergy: number };
      state: UserStateResponse;
    }>('/api/tap', {
      method: 'POST',
      body: JSON.stringify({ taps }),
    }),

  refillEnergy: () =>
    request<{
      refill: { energy: number; refillsLeft: number };
      state: UserStateResponse;
    }>('/api/refill-energy', { method: 'POST' }),

  upgradeBoost: (boostType: BoostType) =>
    request<{
      upgrade: { newLevel: number; cost: number };
      state: UserStateResponse;
    }>('/api/boosts/upgrade', {
      method: 'POST',
      body: JSON.stringify({ boostType }),
    }),

  connectWallet: (address: string, provider = 'TON Connect') =>
    request<{
      walletResult: { friendlyAddress: string; rawAddress: string; bonusAwarded: number };
      state: UserStateResponse;
    }>('/api/wallet/connect', {
      method: 'POST',
      body: JSON.stringify({ address, provider }),
    }),

  disconnectWallet: () =>
    request<{ state: UserStateResponse }>('/api/wallet/disconnect', {
      method: 'POST',
    }),

  getTasks: () => request<{ tasks: TaskItem[] }>('/api/tasks'),

  claimTask: (taskId: number) =>
    request<{
      claimed: { reward: number; taskTitle: string };
      state: UserStateResponse;
      tasks: TaskItem[];
    }>(`/api/tasks/${taskId}/claim`, { method: 'POST' }),

  getReferrals: () => request<{ referrals: ReferralFriend[] }>('/api/referrals'),

  getLeaderboard: () => request<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard'),

  getTransactions: () =>
    request<{ transactions: TransactionRecord[] }>('/api/transactions'),

  // Simulate a new friend joining via current user's referral code (Demo/Sandbox helper)
  simulateReferralJoin: async (referrerId: number) => {
    const fakeId = Math.floor(800_000 + Math.random() * 190_000);
    await request('/api/state', {}, {
      'X-Demo-User-Id': String(fakeId),
      'X-Demo-Start-Param': `ref_${referrerId}`,
    });
    return request<StateWithBotResponse>('/api/state');
  },

  // Admin endpoints
  getAdminOverview: (search = '') =>
    request<{
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
    }>(`/api/admin/overview?search=${encodeURIComponent(search)}`),

  updateAdminSettings: (partial: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(partial),
    }),

  createAdminTask: (payload: {
    title: string;
    description: string;
    category: 'social' | 'onchain' | 'milestone';
    reward: number;
    actionUrl?: string;
    verificationType: TaskItem['verificationType'];
    targetValue?: string;
  }) =>
    request<{ task: TaskItem; tasks: TaskItem[] }>('/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleAdminTask: (id: number, isActive: boolean) =>
    request<{ tasks: TaskItem[] }>(`/api/admin/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  deleteAdminTask: (id: number) =>
    request<{ tasks: TaskItem[] }>(`/api/admin/tasks/${id}`, {
      method: 'DELETE',
    }),

  adjustUserBalance: (telegramId: number, delta: number, reason: string) =>
    request(`/api/admin/users/${telegramId}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ delta, reason }),
    }),

  banUser: (telegramId: number, banned: boolean) =>
    request(`/api/admin/users/${telegramId}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned }),
    }),

  broadcastMessage: (message: string) =>
    request<{ result: { sent: number; failed: number } }>('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

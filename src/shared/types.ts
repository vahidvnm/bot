export const DAILY_STREAK_REWARDS = [500, 1000, 1800, 3000, 5000, 7500, 12000] as const;

export const STORAGE_HOURS_BY_LEVEL = [4, 6, 8, 12, 16, 24] as const;

export const MAX_DAILY_ENERGY_REFILLS = 3;
export const ENERGY_REGEN_PER_SEC = 2;
export const WALLET_CONNECT_BONUS = 5000;

export type BoostType = 'multitap' | 'energy_limit' | 'mining_rig' | 'storage_tank';

export interface BoostDefinition {
  id: BoostType;
  title: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costMultiplier: number;
}

export const BOOST_CATALOG: Record<BoostType, BoostDefinition> = {
  multitap: {
    id: 'multitap',
    title: 'Multitap Core',
    description: '+2 tokens earned per tap for every upgrade level',
    maxLevel: 15,
    baseCost: 500,
    costMultiplier: 1.85,
  },
  energy_limit: {
    id: 'energy_limit',
    title: 'Energy Capacitor',
    description: '+500 maximum tap energy capacity per level',
    maxLevel: 15,
    baseCost: 600,
    costMultiplier: 1.8,
  },
  mining_rig: {
    id: 'mining_rig',
    title: 'Quantum Miner',
    description: 'Boosts passive hourly token generation rate',
    maxLevel: 15,
    baseCost: 800,
    costMultiplier: 1.9,
  },
  storage_tank: {
    id: 'storage_tank',
    title: 'Vault Duration',
    description: 'Extends offline passive mining storage hours (up to 24h)',
    maxLevel: STORAGE_HOURS_BY_LEVEL.length,
    baseCost: 1200,
    costMultiplier: 2.2,
  },
};

export function getBoostCost(type: BoostType, currentLevel: number): number {
  const def = BOOST_CATALOG[type];
  if (currentLevel >= def.maxLevel) return 0;
  return Math.round((def.baseCost * Math.pow(def.costMultiplier, currentLevel - 1)) / 10) * 10;
}

export function getTapPower(multitapLevel: number): number {
  return multitapLevel * 2;
}

export function getMaxEnergy(energyLevel: number): number {
  return energyLevel * 500;
}

export function getMiningRatePerHour(miningLevel: number): number {
  // Level 1: 120/hr, Level 2: 220/hr, Level 3: 350/hr, scales rewarding upgrades
  return Math.round(120 + (miningLevel - 1) * 90 + Math.pow(miningLevel - 1, 1.55) * 25);
}

export function getStorageHours(storageLevel: number): number {
  const idx = Math.min(Math.max(storageLevel - 1, 0), STORAGE_HOURS_BY_LEVEL.length - 1);
  return STORAGE_HOURS_BY_LEVEL[idx];
}

export interface LeagueInfo {
  name: string;
  minEarned: number;
  badge: string;
  color: string;
}

export const LEAGUES: LeagueInfo[] = [
  { name: 'Bronze Explorer', minEarned: 0, badge: '🥉', color: '#CD7F32' },
  { name: 'Silver Pioneer', minEarned: 10_000, badge: '🥈', color: '#94A3B8' },
  { name: 'Gold Vanguard', minEarned: 50_000, badge: '🥇', color: '#FACC15' },
  { name: 'Platinum Whale', minEarned: 200_000, badge: '💠', color: '#38BDF8' },
  { name: 'Diamond Titan', minEarned: 750_000, badge: '💎', color: '#A855F7' },
];

export function getUserLeague(totalEarned: number): {
  current: LeagueInfo;
  next: LeagueInfo | null;
  progressPct: number;
} {
  let currentIdx = 0;
  for (let i = 0; i < LEAGUES.length; i++) {
    if (totalEarned >= LEAGUES[i].minEarned) {
      currentIdx = i;
    }
  }
  const current = LEAGUES[currentIdx];
  const next = currentIdx + 1 < LEAGUES.length ? LEAGUES[currentIdx + 1] : null;
  if (!next) {
    return { current, next: null, progressPct: 100 };
  }
  const span = next.minEarned - current.minEarned;
  const pct = Math.min(100, Math.max(0, ((totalEarned - current.minEarned) / span) * 100));
  return { current, next, progressPct: Math.round(pct) };
}

export type TaskCategory = 'social' | 'onchain' | 'milestone';
export type TaskVerificationType =
  | 'telegram_channel'
  | 'external_link'
  | 'wallet_connect'
  | 'invite_count'
  | 'streak_days';

export interface TaskItem {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: TaskCategory;
  reward: number;
  actionUrl: string | null;
  verificationType: TaskVerificationType;
  targetValue: string | null; // e.g. "@NovaAnnouncement" or "3" invites or "7" days
  isActive: boolean;
  completed?: boolean;
  completedAt?: string | null;
}

export interface TransactionRecord {
  id: number;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

export interface ReferralFriend {
  telegramId: number;
  username: string | null;
  firstName: string;
  totalEarned: number;
  joinedAt: string;
  isPremium: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  balance: number;
  totalEarned: number;
  walletConnected: boolean;
}

export interface AppSettings {
  tokenName: string;
  tokenSymbol: string;
  referralRewardRegular: number;
  referralRewardPremium: number;
  referralCommissionPct: number;
  airdropPhase: string;
  snapshotDate: string;
  botUsername: string;
}

export interface UserStateResponse {
  user: {
    telegramId: number;
    username: string | null;
    firstName: string;
    lastName: string | null;
    isPremium: boolean;
    isAdmin: boolean;
    balance: number;
    totalEarned: number;
    walletAddress: string | null;
    walletRawAddress: string | null;
    walletProvider: string | null;
    walletConnectedAt: string | null;
    walletBonusClaimed: boolean;
    dailyStreak: number;
    canClaimDaily: boolean;
    nextStreakDay: number;
    nextDailyReward: number;
    lastDailyDate: string | null;
    nextDailyResetIso: string;
    energy: number;
    maxEnergy: number;
    tapPower: number;
    dailyRefillsUsed: number;
    dailyRefillsLeft: number;
    miningRatePerHour: number;
    storageHours: number;
    miningCapacity: number;
    miningPending: number;
    miningStartedAt: string;
    levels: {
      multitap: number;
      energy_limit: number;
      mining_rig: number;
      storage_tank: number;
    };
    referralCode: string;
    referralLink: string;
    referralsCount: number;
    referralEarnings: number;
    rank: number;
  };
  settings: AppSettings;
  authMode: 'telegram' | 'demo';
}

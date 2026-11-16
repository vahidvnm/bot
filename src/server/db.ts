import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AppSettings,
  BOOST_CATALOG,
  BoostType,
  DAILY_STREAK_REWARDS,
  ENERGY_REGEN_PER_SEC,
  LeaderboardEntry,
  MAX_DAILY_ENERGY_REFILLS,
  ReferralFriend,
  TaskItem,
  TransactionRecord,
  UserStateResponse,
  WALLET_CONNECT_BONUS,
  getBoostCost,
  getMaxEnergy,
  getMiningRatePerHour,
  getStorageHours,
  getTapPower,
} from '../shared/types.js';
import { parseTonAddress } from '../shared/ton.js';

// DATABASE_PATH lets you point SQLite at a mounted persistent volume
// (e.g. DATABASE_PATH=/var/data/airdrop.db on Railway / Fly / a VPS).
const DB_PATH = process.env.DATABASE_PATH?.trim()
  ? path.resolve(process.env.DATABASE_PATH.trim())
  : path.resolve(process.cwd(), 'data', 'airdrop.db');

const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode & foreign keys for high concurrency between Bot and Web API
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    is_premium INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    total_earned INTEGER NOT NULL DEFAULT 0,
    wallet_address TEXT,
    wallet_raw_address TEXT,
    wallet_provider TEXT,
    wallet_connected_at TEXT,
    wallet_bonus_claimed INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_date TEXT,
    energy REAL NOT NULL DEFAULT 500,
    energy_updated_at INTEGER NOT NULL,
    daily_refills_used INTEGER NOT NULL DEFAULT 0,
    last_refill_date TEXT,
    mining_started_at INTEGER NOT NULL,
    level_multitap INTEGER NOT NULL DEFAULT 1,
    level_energy_limit INTEGER NOT NULL DEFAULT 1,
    level_mining_rig INTEGER NOT NULL DEFAULT 1,
    level_storage_tank INTEGER NOT NULL DEFAULT 1,
    referred_by INTEGER,
    referral_earnings INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    reward INTEGER NOT NULL,
    action_url TEXT,
    verification_type TEXT NOT NULL,
    target_value TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_tasks (
    telegram_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (telegram_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_total_earned ON users(total_earned DESC);
  CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(telegram_id, id DESC);
`);

function getUtcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getYesterdayUtcDateString(now = new Date()): string {
  const d = new Date(now.getTime() - 86_400_000);
  return d.toISOString().slice(0, 10);
}

function getNextUtcMidnightIso(now = new Date()): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return next.toISOString();
}

function seedDefaults(): void {
  const defaultSettings: Record<string, string> = {
    token_name: process.env.TOKEN_NAME || 'NovaTON',
    token_symbol: process.env.TOKEN_SYMBOL || 'NOVA',
    referral_reward_regular: '2500',
    referral_reward_premium: '5000',
    referral_commission_pct: '10',
    airdrop_phase: 'Season 1 — Genesis Farming',
    snapshot_date: '2026-12-31',
    bot_username: (process.env.BOT_USERNAME || 'NovaDropBot').replace(/^@/, ''),
  };

  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }

  const taskCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM tasks`).get() as {
    cnt: number;
  };
  if (taskCountRow.cnt === 0) {
    const insertTask = db.prepare(`
      INSERT INTO tasks (slug, title, description, category, reward, action_url, verification_type, target_value, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    insertTask.run(
      'join-tg-channel',
      'Join Official Telegram Channel',
      'Subscribe to our official announcement channel for snapshot & TGE updates.',
      'social',
      3000,
      'https://t.me/toncoin',
      'telegram_channel',
      '', // Set e.g. @YourChannel in Admin Panel to enforce live getChatMember check
      1
    );
    insertTask.run(
      'follow-x',
      'Follow Official X (Twitter)',
      'Follow our X account and stay tuned for daily bonus codes.',
      'social',
      2500,
      'https://x.com/ton_blockchain',
      'external_link',
      null,
      2
    );
    insertTask.run(
      'connect-ton-wallet',
      'Verify TON Wallet Eligibility',
      'Connect your Tonkeeper or Telegram Wallet to qualify for the TGE Jetton drop.',
      'onchain',
      5000,
      null,
      'wallet_connect',
      null,
      3
    );
    insertTask.run(
      'invite-1-friend',
      'Invite Your First Friend',
      'Share your personal invite link and onboard 1 friend.',
      'milestone',
      3500,
      null,
      'invite_count',
      '1',
      4
    );
    insertTask.run(
      'invite-5-friends',
      'Squad Builder (5 Invites)',
      'Invite 5 active friends to unlock the Squad Builder bonus.',
      'milestone',
      15000,
      null,
      'invite_count',
      '5',
      5
    );
    insertTask.run(
      'streak-7-days',
      '7-Day Streak Master',
      'Maintain a 7-day consecutive daily check-in streak.',
      'milestone',
      20000,
      null,
      'streak_days',
      '7',
      6
    );
  }

  // Seed initial showcase pioneers if database is empty so Leaderboard looks great immediately
  const userCountRow = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as {
    cnt: number;
  };
  if (userCountRow.cnt === 0) {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const pioneers = [
      { id: -101, username: 'ton_whale', firstName: 'Alexey TON', balance: 148500, earned: 182400, wallet: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEBI' },
      { id: -102, username: 'elena_web3', firstName: 'Elena V.', balance: 96200, earned: 118000, wallet: 'UQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p9q2' },
      { id: -103, username: 'amir_crypto', firstName: 'Amir', balance: 64900, earned: 79500, wallet: 'UQBx7t3B8xL6y9k2M0pQ5vR8nW1zK4jH7fG3dS9aP2oI5uYw' },
      { id: -104, username: 'satoshi_node', firstName: 'Liam K.', balance: 38400, earned: 44200, wallet: null },
      { id: -105, username: 'nova_hunter', firstName: 'Sofia', balance: 19750, earned: 23500, wallet: null },
    ];
    const insertPioneer = db.prepare(`
      INSERT INTO users (
        telegram_id, username, first_name, is_premium, balance, total_earned,
        wallet_address, wallet_provider, wallet_connected_at,
        daily_streak, energy, energy_updated_at, mining_started_at, created_at, last_active_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 5, 500, ?, ?, ?, ?)
    `);
    for (const p of pioneers) {
      // Only store valid TON addresses or null
      const parsed = p.wallet ? parseTonAddress(p.wallet) : null;
      insertPioneer.run(
        p.id,
        p.username,
        p.firstName,
        p.balance,
        p.earned,
        parsed ? parsed.friendly : null,
        parsed ? 'Tonkeeper' : null,
        parsed ? nowIso : null,
        nowMs,
        nowMs - 7_200_000,
        nowIso,
        nowIso
      );
    }
  }
}

seedDefaults();

export function getSettings(): AppSettings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  return {
    tokenName: map.token_name || 'NovaTON',
    tokenSymbol: map.token_symbol || 'NOVA',
    referralRewardRegular: parseInt(map.referral_reward_regular || '2500', 10),
    referralRewardPremium: parseInt(map.referral_reward_premium || '5000', 10),
    referralCommissionPct: parseInt(map.referral_commission_pct || '10', 10),
    airdropPhase: map.airdrop_phase || 'Season 1 — Genesis Farming',
    snapshotDate: map.snapshot_date || '2026-12-31',
    botUsername: (map.bot_username || process.env.BOT_USERNAME || 'NovaDropBot').replace(
      /^@/,
      ''
    ),
  };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const mapping: Array<[keyof AppSettings, string]> = [
    ['tokenName', 'token_name'],
    ['tokenSymbol', 'token_symbol'],
    ['referralRewardRegular', 'referral_reward_regular'],
    ['referralRewardPremium', 'referral_reward_premium'],
    ['referralCommissionPct', 'referral_commission_pct'],
    ['airdropPhase', 'airdrop_phase'],
    ['snapshotDate', 'snapshot_date'],
    ['botUsername', 'bot_username'],
  ];

  for (const [prop, dbKey] of mapping) {
    if (partial[prop] !== undefined) {
      upsert.run(dbKey, String(partial[prop]).trim());
    }
  }
  return getSettings();
}

export function isAdminTelegramId(telegramId: number): boolean {
  const raw = process.env.ADMIN_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  return ids.includes(telegramId);
}

interface RawUserRow {
  telegram_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  is_premium: number;
  is_banned: number;
  balance: number;
  total_earned: number;
  wallet_address: string | null;
  wallet_raw_address: string | null;
  wallet_provider: string | null;
  wallet_connected_at: string | null;
  wallet_bonus_claimed: number;
  daily_streak: number;
  last_daily_date: string | null;
  energy: number;
  energy_updated_at: number;
  daily_refills_used: number;
  last_refill_date: string | null;
  mining_started_at: number;
  level_multitap: number;
  level_energy_limit: number;
  level_mining_rig: number;
  level_storage_tank: number;
  referred_by: number | null;
  referral_earnings: number;
  created_at: string;
  last_active_at: string;
}

export function addTransaction(
  telegramId: number,
  type: string,
  amount: number,
  description: string
): void {
  db.prepare(
    `INSERT INTO transactions (telegram_id, type, amount, description, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(telegramId, type, amount, description, new Date().toISOString());
}

export interface UpsertUserInput {
  telegramId: number;
  username?: string | null;
  firstName: string;
  lastName?: string | null;
  isPremium?: boolean;
  referrerId?: number | null;
}

export interface UpsertUserResult {
  isNewUser: boolean;
  referrerRewardedId: number | null;
  referrerBonusAmount: number;
}

export function ensureUser(input: UpsertUserInput): UpsertUserResult {
  const existing = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(input.telegramId) as RawUserRow | undefined;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (existing) {
    db.prepare(
      `UPDATE users
       SET username = COALESCE(?, username),
           first_name = ?,
           last_name = COALESCE(?, last_name),
           is_premium = ?,
           last_active_at = ?
       WHERE telegram_id = ?`
    ).run(
      input.username ?? null,
      input.firstName || existing.first_name,
      input.lastName ?? null,
      input.isPremium ? 1 : existing.is_premium,
      nowIso,
      input.telegramId
    );
    return { isNewUser: false, referrerRewardedId: null, referrerBonusAmount: 0 };
  }

  const settings = getSettings();
  const welcomeBonus = input.isPremium ? 2000 : 1000;

  let validReferrerId: number | null = null;
  if (input.referrerId && input.referrerId !== input.telegramId && input.referrerId > 0) {
    const refRow = db
      .prepare(`SELECT telegram_id FROM users WHERE telegram_id = ?`)
      .get(input.referrerId) as { telegram_id: number } | undefined;
    if (refRow) {
      validReferrerId = refRow.telegram_id;
    }
  }

  // Extra welcome gift if invited by a friend
  const inviteeExtra = validReferrerId ? 1500 : 0;
  const startingBalance = welcomeBonus + inviteeExtra;

  db.prepare(
    `INSERT INTO users (
      telegram_id, username, first_name, last_name, is_premium,
      balance, total_earned, energy, energy_updated_at, mining_started_at,
      referred_by, created_at, last_active_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 500, ?, ?, ?, ?, ?)`
  ).run(
    input.telegramId,
    input.username ?? null,
    input.firstName || 'Explorer',
    input.lastName ?? null,
    input.isPremium ? 1 : 0,
    startingBalance,
    startingBalance,
    nowMs,
    nowMs,
    validReferrerId,
    nowIso,
    nowIso
  );

  addTransaction(
    input.telegramId,
    'welcome',
    startingBalance,
    validReferrerId
      ? `Welcome bonus + Referral gift (+${startingBalance} $${settings.tokenSymbol})`
      : `Genesis welcome bonus (+${startingBalance} $${settings.tokenSymbol})`
  );

  let referrerBonusAmount = 0;
  if (validReferrerId) {
    referrerBonusAmount = input.isPremium
      ? settings.referralRewardPremium
      : settings.referralRewardRegular;

    db.prepare(
      `UPDATE users
       SET balance = balance + ?,
           total_earned = total_earned + ?,
           referral_earnings = referral_earnings + ?
       WHERE telegram_id = ?`
    ).run(referrerBonusAmount, referrerBonusAmount, referrerBonusAmount, validReferrerId);

    addTransaction(
      validReferrerId,
      'referral_bonus',
      referrerBonusAmount,
      `Invited friend ${input.firstName}${input.isPremium ? ' (Telegram Premium)' : ''}`
    );
  }

  return {
    isNewUser: true,
    referrerRewardedId: validReferrerId,
    referrerBonusAmount,
  };
}

function computeSyncedEnergy(row: RawUserRow, nowMs = Date.now()): number {
  const maxEnergy = getMaxEnergy(row.level_energy_limit);
  const elapsedSec = Math.max(0, (nowMs - row.energy_updated_at) / 1000);
  const regenerated = row.energy + elapsedSec * ENERGY_REGEN_PER_SEC;
  return Math.min(maxEnergy, Math.floor(regenerated));
}

function computeMiningPending(row: RawUserRow, nowMs = Date.now()): {
  ratePerHour: number;
  storageHours: number;
  capacity: number;
  pending: number;
} {
  const ratePerHour = getMiningRatePerHour(row.level_mining_rig);
  const storageHours = getStorageHours(row.level_storage_tank);
  const capacity = ratePerHour * storageHours;
  const elapsedHours = Math.max(0, (nowMs - row.mining_started_at) / 3_600_000);
  const rawEarned = Math.floor(elapsedHours * ratePerHour);
  const pending = Math.min(capacity, rawEarned);
  return { ratePerHour, storageHours, capacity, pending };
}

function computeDailyStatus(row: RawUserRow, now = new Date()): {
  canClaim: boolean;
  effectiveStreak: number;
  nextStreakDay: number;
  nextReward: number;
} {
  const today = getUtcDateString(now);
  const yesterday = getYesterdayUtcDateString(now);

  if (row.last_daily_date === today) {
    const nextDay = (row.daily_streak % DAILY_STREAK_REWARDS.length) + 1;
    return {
      canClaim: false,
      effectiveStreak: row.daily_streak,
      nextStreakDay: nextDay,
      nextReward: DAILY_STREAK_REWARDS[nextDay - 1],
    };
  }

  const continuing = row.last_daily_date === yesterday;
  const effectiveStreak = continuing ? row.daily_streak : 0;
  const nextStreakDay = (effectiveStreak % DAILY_STREAK_REWARDS.length) + 1;
  const nextReward = DAILY_STREAK_REWARDS[nextStreakDay - 1];

  return {
    canClaim: true,
    effectiveStreak,
    nextStreakDay,
    nextReward,
  };
}

export function buildUserState(
  telegramId: number,
  authMode: 'telegram' | 'demo' = 'telegram',
  forceAdmin = false
): UserStateResponse {
  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;

  if (!row) {
    throw new Error('User not found');
  }

  const settings = getSettings();
  const now = new Date();
  const nowMs = now.getTime();
  const today = getUtcDateString(now);

  const energy = computeSyncedEnergy(row, nowMs);
  const maxEnergy = getMaxEnergy(row.level_energy_limit);
  const tapPower = getTapPower(row.level_multitap);
  const mining = computeMiningPending(row, nowMs);
  const daily = computeDailyStatus(row, now);

  const refillsUsed = row.last_refill_date === today ? row.daily_refills_used : 0;

  const referralsCountRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?`)
    .get(telegramId) as { cnt: number };

  const rankRow = db
    .prepare(
      `SELECT COUNT(*) + 1 as rank FROM users WHERE total_earned > ? AND is_banned = 0`
    )
    .get(row.total_earned) as { rank: number };

  const referralCode = `ref_${row.telegram_id}`;
  const referralLink = `https://t.me/${settings.botUsername}?start=${referralCode}`;

  return {
    user: {
      telegramId: row.telegram_id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isPremium: Boolean(row.is_premium),
      isAdmin: forceAdmin || isAdminTelegramId(row.telegram_id),
      balance: row.balance,
      totalEarned: row.total_earned,
      walletAddress: row.wallet_address,
      walletRawAddress: row.wallet_raw_address,
      walletProvider: row.wallet_provider,
      walletConnectedAt: row.wallet_connected_at,
      walletBonusClaimed: Boolean(row.wallet_bonus_claimed),
      dailyStreak: daily.effectiveStreak,
      canClaimDaily: daily.canClaim,
      nextStreakDay: daily.nextStreakDay,
      nextDailyReward: daily.nextReward,
      lastDailyDate: row.last_daily_date,
      nextDailyResetIso: getNextUtcMidnightIso(now),
      energy,
      maxEnergy,
      tapPower,
      dailyRefillsUsed: refillsUsed,
      dailyRefillsLeft: Math.max(0, MAX_DAILY_ENERGY_REFILLS - refillsUsed),
      miningRatePerHour: mining.ratePerHour,
      storageHours: mining.storageHours,
      miningCapacity: mining.capacity,
      miningPending: mining.pending,
      miningStartedAt: new Date(row.mining_started_at).toISOString(),
      levels: {
        multitap: row.level_multitap,
        energy_limit: row.level_energy_limit,
        mining_rig: row.level_mining_rig,
        storage_tank: row.level_storage_tank,
      },
      referralCode,
      referralLink,
      referralsCount: referralsCountRow.cnt,
      referralEarnings: row.referral_earnings,
      rank: rankRow.rank,
    },
    settings,
    authMode,
  };
}

function distributeReferralCommission(
  earnerId: number,
  referredBy: number | null,
  baseEarned: number,
  sourceLabel: string
): void {
  if (!referredBy || baseEarned <= 0) return;
  const settings = getSettings();
  const commission = Math.floor((baseEarned * settings.referralCommissionPct) / 100);
  if (commission <= 0) return;

  db.prepare(
    `UPDATE users
     SET balance = balance + ?,
         total_earned = total_earned + ?,
         referral_earnings = referral_earnings + ?
     WHERE telegram_id = ?`
  ).run(commission, commission, commission, referredBy);

  addTransaction(
    referredBy,
    'referral_commission',
    commission,
    `${settings.referralCommissionPct}% commission from friend #${earnerId} (${sourceLabel})`
  );
}

export function claimDailyReward(telegramId: number): {
  reward: number;
  newStreak: number;
  nextResetIso: string;
} {
  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');
  if (row.is_banned) throw new Error('Account is restricted');

  const now = new Date();
  const today = getUtcDateString(now);
  const daily = computeDailyStatus(row, now);

  if (!daily.canClaim) {
    throw new Error('Daily reward already claimed today. Come back after 00:00 UTC!');
  }

  const newStreak = daily.effectiveStreak + 1;
  const reward = daily.nextReward;

  db.prepare(
    `UPDATE users
     SET balance = balance + ?,
         total_earned = total_earned + ?,
         daily_streak = ?,
         last_daily_date = ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(reward, reward, newStreak, today, now.toISOString(), telegramId);

  addTransaction(
    telegramId,
    'daily_claim',
    reward,
    `Day ${daily.nextStreakDay} streak reward (Total streak: ${newStreak}d)`
  );

  distributeReferralCommission(telegramId, row.referred_by, reward, 'Daily Claim');

  return {
    reward,
    newStreak,
    nextResetIso: getNextUtcMidnightIso(now),
  };
}

export function claimMiningStorage(telegramId: number): {
  claimed: number;
} {
  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');
  if (row.is_banned) throw new Error('Account is restricted');

  const nowMs = Date.now();
  const mining = computeMiningPending(row, nowMs);
  if (mining.pending < 1) {
    throw new Error('Mining vault has less than 1 token accumulated yet. Give it a minute!');
  }

  db.prepare(
    `UPDATE users
     SET balance = balance + ?,
         total_earned = total_earned + ?,
         mining_started_at = ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(mining.pending, mining.pending, nowMs, new Date(nowMs).toISOString(), telegramId);

  addTransaction(
    telegramId,
    'mining_claim',
    mining.pending,
    `Harvested passive mining vault (+${mining.pending})`
  );

  distributeReferralCommission(telegramId, row.referred_by, mining.pending, 'Mining Harvest');

  return { claimed: mining.pending };
}

export function processTaps(
  telegramId: number,
  requestedTaps: number
): {
  acceptedTaps: number;
  earned: number;
  remainingEnergy: number;
} {
  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');
  if (row.is_banned) throw new Error('Account is restricted');

  const clampedRequest = Math.min(Math.max(1, Math.floor(requestedTaps)), 80);
  const nowMs = Date.now();
  const currentEnergy = computeSyncedEnergy(row, nowMs);
  const tapPower = getTapPower(row.level_multitap);

  const maxPossibleTaps = Math.floor(currentEnergy / tapPower);
  const acceptedTaps = Math.min(clampedRequest, maxPossibleTaps);
  if (acceptedTaps <= 0) {
    return { acceptedTaps: 0, earned: 0, remainingEnergy: currentEnergy };
  }

  const earned = acceptedTaps * tapPower;
  const remainingEnergy = Math.max(0, currentEnergy - earned);

  db.prepare(
    `UPDATE users
     SET balance = balance + ?,
         total_earned = total_earned + ?,
         energy = ?,
         energy_updated_at = ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(earned, earned, remainingEnergy, nowMs, new Date(nowMs).toISOString(), telegramId);

  return { acceptedTaps, earned, remainingEnergy };
}

export function refillEnergy(telegramId: number): { energy: number; refillsLeft: number } {
  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');

  const now = new Date();
  const nowMs = now.getTime();
  const today = getUtcDateString(now);
  const usedToday = row.last_refill_date === today ? row.daily_refills_used : 0;

  if (usedToday >= MAX_DAILY_ENERGY_REFILLS) {
    throw new Error('All 3 daily energy refills have been used today.');
  }

  const maxEnergy = getMaxEnergy(row.level_energy_limit);
  const newUsed = usedToday + 1;

  db.prepare(
    `UPDATE users
     SET energy = ?,
         energy_updated_at = ?,
         daily_refills_used = ?,
         last_refill_date = ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(maxEnergy, nowMs, newUsed, today, now.toISOString(), telegramId);

  return {
    energy: maxEnergy,
    refillsLeft: MAX_DAILY_ENERGY_REFILLS - newUsed,
  };
}

export function upgradeBoost(
  telegramId: number,
  boostType: BoostType
): { newLevel: number; cost: number } {
  const def = BOOST_CATALOG[boostType];
  if (!def) throw new Error('Invalid boost type');

  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');

  const colMap: Record<BoostType, keyof RawUserRow> = {
    multitap: 'level_multitap',
    energy_limit: 'level_energy_limit',
    mining_rig: 'level_mining_rig',
    storage_tank: 'level_storage_tank',
  };

  const currentLevel = row[colMap[boostType]] as number;
  if (currentLevel >= def.maxLevel) {
    throw new Error(`${def.title} is already at maximum level (${def.maxLevel}).`);
  }

  const cost = getBoostCost(boostType, currentLevel);
  if (row.balance < cost) {
    throw new Error(`Insufficient balance. Need ${cost.toLocaleString()} tokens.`);
  }

  const newLevel = currentLevel + 1;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // If upgrading mining_rig, auto-harvest any pending mining tokens first so progress isn't skewed
  if (boostType === 'mining_rig') {
    const pending = computeMiningPending(row, nowMs).pending;
    if (pending > 0) {
      db.prepare(
        `UPDATE users
         SET balance = balance + ? - ?,
             total_earned = total_earned + ?,
             mining_started_at = ?,
             level_mining_rig = ?,
             last_active_at = ?
         WHERE telegram_id = ?`
      ).run(pending, cost, pending, nowMs, newLevel, nowIso, telegramId);
      addTransaction(
        telegramId,
        'mining_claim',
        pending,
        `Auto-harvested vault before ${def.title} upgrade`
      );
    } else {
      db.prepare(
        `UPDATE users
         SET balance = balance - ?,
             level_mining_rig = ?,
             last_active_at = ?
         WHERE telegram_id = ?`
      ).run(cost, newLevel, nowIso, telegramId);
    }
  } else if (boostType === 'energy_limit') {
    const newMax = getMaxEnergy(newLevel);
    db.prepare(
      `UPDATE users
       SET balance = balance - ?,
           level_energy_limit = ?,
           energy = ?,
           energy_updated_at = ?,
           last_active_at = ?
       WHERE telegram_id = ?`
    ).run(cost, newLevel, newMax, nowMs, nowIso, telegramId);
  } else if (boostType === 'multitap') {
    db.prepare(
      `UPDATE users
       SET balance = balance - ?,
           level_multitap = ?,
           last_active_at = ?
       WHERE telegram_id = ?`
    ).run(cost, newLevel, nowIso, telegramId);
  } else {
    db.prepare(
      `UPDATE users
       SET balance = balance - ?,
           level_storage_tank = ?,
           last_active_at = ?
       WHERE telegram_id = ?`
    ).run(cost, newLevel, nowIso, telegramId);
  }

  addTransaction(
    telegramId,
    'boost_upgrade',
    -cost,
    `Upgraded ${def.title} to Level ${newLevel}`
  );

  return { newLevel, cost };
}

export function connectUserWallet(
  telegramId: number,
  addressInput: string,
  providerName = 'TON Connect'
): {
  friendlyAddress: string;
  rawAddress: string;
  bonusAwarded: number;
} {
  const parsed = parseTonAddress(addressInput);
  if (!parsed) {
    throw new Error(
      'Invalid TON wallet address. Expected a valid TON address (UQ... / EQ... or 0:hex).'
    );
  }

  const row = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!row) throw new Error('User not found');

  // Prevent linking exact same wallet to multiple accounts (anti-sybil protection!)
  const duplicate = db
    .prepare(
      `SELECT telegram_id FROM users WHERE wallet_raw_address = ? AND telegram_id != ?`
    )
    .get(parsed.raw, telegramId) as { telegram_id: number } | undefined;
  if (duplicate) {
    throw new Error('This TON wallet is already linked to another airdrop account.');
  }

  const nowIso = new Date().toISOString();
  const isFirstBonus = row.wallet_bonus_claimed === 0;
  const bonus = isFirstBonus ? WALLET_CONNECT_BONUS : 0;

  db.prepare(
    `UPDATE users
     SET wallet_address = ?,
         wallet_raw_address = ?,
         wallet_provider = ?,
         wallet_connected_at = ?,
         wallet_bonus_claimed = CASE WHEN wallet_bonus_claimed = 1 THEN 1 ELSE 1 END,
         balance = balance + ?,
         total_earned = total_earned + ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(
    parsed.friendly,
    parsed.raw,
    providerName,
    nowIso,
    bonus,
    bonus,
    nowIso,
    telegramId
  );

  if (bonus > 0) {
    addTransaction(
      telegramId,
      'wallet_bonus',
      bonus,
      `First-time TON Wallet connection bonus (${providerName})`
    );
  }

  return {
    friendlyAddress: parsed.friendly,
    rawAddress: parsed.raw,
    bonusAwarded: bonus,
  };
}

export function disconnectUserWallet(telegramId: number): void {
  db.prepare(
    `UPDATE users
     SET wallet_address = NULL,
         wallet_raw_address = NULL,
         wallet_provider = NULL,
         wallet_connected_at = NULL
     WHERE telegram_id = ?`
  ).run(telegramId);
}

export function getUserTasks(telegramId: number): TaskItem[] {
  const rows = db
    .prepare(
      `SELECT t.*, ut.completed_at
       FROM tasks t
       LEFT JOIN user_tasks ut ON ut.task_id = t.id AND ut.telegram_id = ?
       WHERE t.is_active = 1
       ORDER BY t.sort_order ASC, t.id ASC`
    )
    .all(telegramId) as Array<{
    id: number;
    slug: string;
    title: string;
    description: string;
    category: 'social' | 'onchain' | 'milestone';
    reward: number;
    action_url: string | null;
    verification_type: TaskItem['verificationType'];
    target_value: string | null;
    is_active: number;
    completed_at: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    category: r.category,
    reward: r.reward,
    actionUrl: r.action_url,
    verificationType: r.verification_type,
    targetValue: r.target_value,
    isActive: Boolean(r.is_active),
    completed: Boolean(r.completed_at),
    completedAt: r.completed_at,
  }));
}

export function getTaskById(taskId: number): TaskItem | null {
  const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as
    | {
        id: number;
        slug: string;
        title: string;
        description: string;
        category: 'social' | 'onchain' | 'milestone';
        reward: number;
        action_url: string | null;
        verification_type: TaskItem['verificationType'];
        target_value: string | null;
        is_active: number;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    category: r.category,
    reward: r.reward,
    actionUrl: r.action_url,
    verificationType: r.verification_type,
    targetValue: r.target_value,
    isActive: Boolean(r.is_active),
  };
}

export function completeTaskForUser(
  telegramId: number,
  taskId: number
): { reward: number; taskTitle: string } {
  const task = getTaskById(taskId);
  if (!task || !task.isActive) {
    throw new Error('Task not found or inactive.');
  }

  const already = db
    .prepare(`SELECT completed_at FROM user_tasks WHERE telegram_id = ? AND task_id = ?`)
    .get(telegramId, taskId);
  if (already) {
    throw new Error('You have already claimed this task reward.');
  }

  const user = db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .get(telegramId) as RawUserRow | undefined;
  if (!user) throw new Error('User not found');

  // Built-in server-side verification checks
  if (task.verificationType === 'wallet_connect') {
    if (!user.wallet_address) {
      throw new Error('Please connect your TON wallet first on the Wallet tab.');
    }
  } else if (task.verificationType === 'invite_count') {
    const required = parseInt(task.targetValue || '1', 10);
    const invRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?`)
      .get(telegramId) as { cnt: number };
    if (invRow.cnt < required) {
      throw new Error(
        `You need ${required} invited friend(s) to claim this milestone (current: ${invRow.cnt}).`
      );
    }
  } else if (task.verificationType === 'streak_days') {
    const required = parseInt(task.targetValue || '7', 10);
    if (user.daily_streak < required) {
      throw new Error(
        `Reach a ${required}-day daily check-in streak first (current: ${user.daily_streak}d).`
      );
    }
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_tasks (telegram_id, task_id, completed_at) VALUES (?, ?, ?)`
  ).run(telegramId, taskId, nowIso);

  db.prepare(
    `UPDATE users
     SET balance = balance + ?,
         total_earned = total_earned + ?,
         last_active_at = ?
     WHERE telegram_id = ?`
  ).run(task.reward, task.reward, nowIso, telegramId);

  addTransaction(telegramId, 'task_reward', task.reward, `Task completed: ${task.title}`);

  return { reward: task.reward, taskTitle: task.title };
}

export function getUserReferrals(telegramId: number): ReferralFriend[] {
  const rows = db
    .prepare(
      `SELECT telegram_id, username, first_name, total_earned, created_at, is_premium
       FROM users
       WHERE referred_by = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(telegramId) as Array<{
    telegram_id: number;
    username: string | null;
    first_name: string;
    total_earned: number;
    created_at: string;
    is_premium: number;
  }>;

  return rows.map((r) => ({
    telegramId: r.telegram_id,
    username: r.username,
    firstName: r.first_name,
    totalEarned: r.total_earned,
    joinedAt: r.created_at,
    isPremium: Boolean(r.is_premium),
  }));
}

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT telegram_id, username, first_name, balance, total_earned, wallet_address
       FROM users
       WHERE is_banned = 0
       ORDER BY total_earned DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    telegram_id: number;
    username: string | null;
    first_name: string;
    balance: number;
    total_earned: number;
    wallet_address: string | null;
  }>;

  return rows.map((r, idx) => ({
    rank: idx + 1,
    telegramId: r.telegram_id,
    username: r.username,
    firstName: r.first_name,
    balance: r.balance,
    totalEarned: r.total_earned,
    walletConnected: Boolean(r.wallet_address),
  }));
}

export function getUserTransactions(telegramId: number, limit = 25): TransactionRecord[] {
  const rows = db
    .prepare(
      `SELECT id, type, amount, description, created_at
       FROM transactions
       WHERE telegram_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(telegramId, limit) as Array<{
    id: number;
    type: string;
    amount: number;
    description: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amount: r.amount,
    description: r.description,
    createdAt: r.created_at,
  }));
}

// ================= ADMIN OPERATIONS =================

export function getAdminStats() {
  const today = getUtcDateString();

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) as totalUsers,
         SUM(CASE WHEN telegram_id > 0 THEN 1 ELSE 0 END) as realUsers,
         SUM(CASE WHEN wallet_address IS NOT NULL THEN 1 ELSE 0 END) as connectedWallets,
         COALESCE(SUM(balance), 0) as circulatingBalance,
         COALESCE(SUM(total_earned), 0) as totalMinted,
         SUM(CASE WHEN last_daily_date = ? THEN 1 ELSE 0 END) as claimedToday
       FROM users
       WHERE is_banned = 0`
    )
    .get(today) as {
    totalUsers: number;
    realUsers: number;
    connectedWallets: number;
    circulatingBalance: number;
    totalMinted: number;
    claimedToday: number;
  };

  const tasksCompleted = db
    .prepare(`SELECT COUNT(*) as cnt FROM user_tasks`)
    .get() as { cnt: number };

  return {
    ...totals,
    realUsers: totals.realUsers || 0,
    connectedWallets: totals.connectedWallets || 0,
    claimedToday: totals.claimedToday || 0,
    tasksCompleted: tasksCompleted.cnt,
  };
}

export function getAdminAllTasks(): TaskItem[] {
  const rows = db
    .prepare(`SELECT * FROM tasks ORDER BY sort_order ASC, id ASC`)
    .all() as Array<{
    id: number;
    slug: string;
    title: string;
    description: string;
    category: 'social' | 'onchain' | 'milestone';
    reward: number;
    action_url: string | null;
    verification_type: TaskItem['verificationType'];
    target_value: string | null;
    is_active: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    category: r.category,
    reward: r.reward,
    actionUrl: r.action_url,
    verificationType: r.verification_type,
    targetValue: r.target_value,
    isActive: Boolean(r.is_active),
  }));
}

export function createAdminTask(input: {
  title: string;
  description: string;
  category: 'social' | 'onchain' | 'milestone';
  reward: number;
  actionUrl?: string | null;
  verificationType: TaskItem['verificationType'];
  targetValue?: string | null;
}): TaskItem {
  const slug =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    Date.now().toString(36);

  const info = db
    .prepare(
      `INSERT INTO tasks (slug, title, description, category, reward, action_url, verification_type, target_value, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 99)`
    )
    .run(
      slug,
      input.title.trim(),
      input.description.trim() || 'Complete this quest to earn bonus tokens.',
      input.category,
      Math.max(1, Math.floor(input.reward)),
      input.actionUrl?.trim() || null,
      input.verificationType,
      input.targetValue?.trim() || null
    );

  return getTaskById(Number(info.lastInsertRowid))!;
}

export function toggleAdminTask(taskId: number, isActive: boolean): void {
  db.prepare(`UPDATE tasks SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, taskId);
}

export function deleteAdminTask(taskId: number): void {
  db.prepare(`DELETE FROM user_tasks WHERE task_id = ?`).run(taskId);
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
}

export function listAdminUsers(search = '', limit = 50) {
  const q = `%${search.trim()}%`;
  return db
    .prepare(
      `SELECT telegram_id, username, first_name, balance, total_earned, wallet_address, daily_streak, is_banned, created_at
       FROM users
       WHERE (? = '%%' OR username LIKE ? OR first_name LIKE ? OR CAST(telegram_id AS TEXT) LIKE ? OR wallet_address LIKE ?)
       ORDER BY total_earned DESC
       LIMIT ?`
    )
    .all(q, q, q, q, q, limit);
}

export function adjustUserBalance(
  telegramId: number,
  delta: number,
  reason = 'Admin adjustment'
): void {
  db.prepare(
    `UPDATE users
     SET balance = MAX(0, balance + ?),
         total_earned = CASE WHEN ? > 0 THEN total_earned + ? ELSE total_earned END
     WHERE telegram_id = ?`
  ).run(delta, delta, delta, telegramId);
  addTransaction(telegramId, 'admin_adjust', delta, reason);
}

export function setUserBanStatus(telegramId: number, banned: boolean): void {
  db.prepare(`UPDATE users SET is_banned = ? WHERE telegram_id = ?`).run(
    banned ? 1 : 0,
    telegramId
  );
}

export function exportAirdropSnapshotCsv(): string {
  const rows = db
    .prepare(
      `SELECT
         u.telegram_id,
         u.username,
         u.first_name,
         u.wallet_address,
         u.wallet_raw_address,
         u.balance,
         u.total_earned,
         u.daily_streak,
         (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.telegram_id) as referrals
       FROM users u
       WHERE u.is_banned = 0 AND u.telegram_id > 0
       ORDER BY u.balance DESC`
    )
    .all() as Array<{
    telegram_id: number;
    username: string | null;
    first_name: string;
    wallet_address: string | null;
    wallet_raw_address: string | null;
    balance: number;
    total_earned: number;
    daily_streak: number;
    referrals: number;
  }>;

  const header = [
    'telegram_id',
    'username',
    'first_name',
    'ton_wallet_friendly',
    'ton_wallet_raw',
    'token_balance',
    'total_earned',
    'daily_streak',
    'referrals_count',
  ].join(',');

  const escapeCsv = (val: unknown) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = rows.map((r) =>
    [
      r.telegram_id,
      r.username || '',
      r.first_name,
      r.wallet_address || '',
      r.wallet_raw_address || '',
      r.balance,
      r.total_earned,
      r.daily_streak,
      r.referrals,
    ]
      .map(escapeCsv)
      .join(',')
  );

  return [header, ...lines].join('\n');
}

export function getAllRealTelegramUserIds(): number[] {
  const rows = db
    .prepare(`SELECT telegram_id FROM users WHERE telegram_id > 0 AND is_banned = 0`)
    .all() as Array<{ telegram_id: number }>;
  return rows.map((r) => r.telegram_id);
}

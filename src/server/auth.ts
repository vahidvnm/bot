import { ensureUser, isAdminTelegramId } from './db.js';
import { env } from './config.js';

export interface AuthenticatedTelegramUser {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  isPremium: boolean;
  startParam: string | null;
  authMode: 'telegram' | 'demo';
  isDemoAdmin: boolean;
}

/** Sandbox account that is granted admin rights while no BOT_TOKEN is configured. */
export const DEMO_ADMIN_ID = 777001;

export function isDemoAdminId(telegramId: number): boolean {
  return telegramId === DEMO_ADMIN_ID;
}

/** HTTP error carrying a status code — converted to a JSON response by the route dispatcher. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function hmac(key: string | Uint8Array, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    (typeof key === 'string' ? enc.encode(key) : key) as Parameters<
      typeof crypto.subtle.importKey
    >[1],
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 per official docs).
 * Uses Web Crypto so the exact same code runs on Node and Cloudflare Workers.
 */
export async function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string
): Promise<AuthenticatedTelegramUser | null> {
  if (!initDataRaw || !botToken) return null;

  try {
    const params = new URLSearchParams(initDataRaw);
    const receivedHash = params.get('hash');
    if (!receivedHash) return null;

    const pairs: string[] = [];
    params.forEach((val, key) => {
      if (key !== 'hash') {
        pairs.push(`${key}=${val}`);
      }
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = await hmac('WebAppData', botToken);
    const calculatedHash = toHex(await hmac(secretKey, dataCheckString));

    if (!timingSafeEqualHex(calculatedHash, receivedHash.toLowerCase())) {
      return null;
    }

    const userJson = params.get('user');
    if (!userJson) return null;

    const parsedUser = JSON.parse(userJson) as {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
      is_premium?: boolean;
    };

    return {
      telegramId: parsedUser.id,
      username: parsedUser.username || null,
      firstName: parsedUser.first_name || 'Explorer',
      lastName: parsedUser.last_name || null,
      isPremium: Boolean(parsedUser.is_premium),
      startParam: params.get('start_param'),
      authMode: 'telegram',
      isDemoAdmin: false,
    };
  } catch {
    return null;
  }
}

function parseReferrerIdFromStartParam(startParam: string | null | undefined): number | null {
  if (!startParam) return null;
  const cleaned = startParam.replace(/^ref_/, '');
  const id = parseInt(cleaned, 10);
  return !Number.isNaN(id) && id > 0 ? id : null;
}

export function isDemoModeAllowed(): boolean {
  return env('ALLOW_DEMO_MODE') !== 'false';
}

/**
 * Resolves the requesting user from headers:
 * signed Telegram initData → unsigned initData (demo only) → demo headers → 401.
 * Throws HttpError(401) when nothing matches.
 */
export async function requireAuth(req: Request): Promise<AuthenticatedTelegramUser> {
  const initData = req.headers.get('x-telegram-init-data') || '';
  const botToken = env('BOT_TOKEN') || '';

  if (initData && botToken) {
    const verified = await verifyTelegramInitData(initData, botToken);
    if (verified) {
      await ensureUser({
        telegramId: verified.telegramId,
        username: verified.username,
        firstName: verified.firstName,
        lastName: verified.lastName,
        isPremium: verified.isPremium,
        referrerId: parseReferrerIdFromStartParam(verified.startParam),
      });
      return verified;
    }
  }

  // If opened inside Telegram BEFORE BOT_TOKEN is configured yet, allow parsing unsigned user in Demo mode
  if (initData && !botToken && isDemoModeAllowed()) {
    try {
      const params = new URLSearchParams(initData);
      const userJson = params.get('user');
      if (userJson) {
        const parsed = JSON.parse(userJson) as {
          id: number;
          username?: string;
          first_name?: string;
          last_name?: string;
          is_premium?: boolean;
        };
        const u: AuthenticatedTelegramUser = {
          telegramId: parsed.id,
          username: parsed.username || null,
          firstName: parsed.first_name || 'Explorer',
          lastName: parsed.last_name || null,
          isPremium: Boolean(parsed.is_premium),
          startParam: params.get('start_param'),
          authMode: 'demo',
          isDemoAdmin: isDemoAdminId(parsed.id),
        };
        await ensureUser({
          telegramId: u.telegramId,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          isPremium: u.isPremium,
          referrerId: parseReferrerIdFromStartParam(u.startParam),
        });
        return u;
      }
    } catch {
      // fall through to browser demo user
    }
  }

  if (isDemoModeAllowed()) {
    const customDemoId = parseInt(req.headers.get('x-demo-user-id') || '777001', 10);
    const demoId = !Number.isNaN(customDemoId) && customDemoId > 0 ? customDemoId : 777001;
    const demoRef = parseReferrerIdFromStartParam(req.headers.get('x-demo-start-param'));

    const demoNames: Record<number, { firstName: string; username: string; premium: boolean }> = {
      777001: { firstName: 'Demo Pioneer', username: 'pioneer_ton', premium: true },
      777002: { firstName: 'Invited Friend', username: 'friend_tester', premium: false },
    };
    const meta = demoNames[demoId] || {
      firstName: `Tester #${demoId}`,
      username: `tester_${demoId}`,
      premium: false,
    };

    await ensureUser({
      telegramId: demoId,
      username: meta.username,
      firstName: meta.firstName,
      lastName: null,
      isPremium: meta.premium,
      referrerId: demoRef,
    });

    return {
      telegramId: demoId,
      username: meta.username,
      firstName: meta.firstName,
      lastName: null,
      isPremium: meta.premium,
      startParam: null,
      authMode: 'demo',
      isDemoAdmin: isDemoAdminId(demoId),
    };
  }

  throw new HttpError(401, 'Unauthorized. Please launch this Mini App from inside Telegram.');
}

/** Throws HttpError(403) unless the user is an admin (ADMIN_IDS, demo admin, or ADMIN_SECRET). */
export async function requireAdmin(req: Request, user: AuthenticatedTelegramUser): Promise<void> {
  const adminHeaderSecret = req.headers.get('x-admin-secret') || '';
  const configuredSecret = env('ADMIN_SECRET') || '';

  if (configuredSecret && adminHeaderSecret && adminHeaderSecret === configuredSecret) {
    return;
  }

  if (isAdminTelegramId(user.telegramId) || user.isDemoAdmin) {
    return;
  }

  throw new HttpError(
    403,
    'Admin access required. Set your Telegram ID in ADMIN_IDS or enter ADMIN_SECRET.'
  );
}

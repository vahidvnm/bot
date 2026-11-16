import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ensureUser, isAdminTelegramId } from './db.js';

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

declare global {
  namespace Express {
    interface Request {
      tgUser?: AuthenticatedTelegramUser;
    }
  }
}

export function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string
): AuthenticatedTelegramUser | null {
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

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const a = Buffer.from(calculatedHash, 'hex');
    const b = Buffer.from(receivedHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
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
  return process.env.ALLOW_DEMO_MODE !== 'false';
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const initData = (req.headers['x-telegram-init-data'] as string | undefined) || '';
  const botToken = process.env.BOT_TOKEN || '';

  if (initData && botToken) {
    const verified = verifyTelegramInitData(initData, botToken);
    if (verified) {
      ensureUser({
        telegramId: verified.telegramId,
        username: verified.username,
        firstName: verified.firstName,
        lastName: verified.lastName,
        isPremium: verified.isPremium,
        referrerId: parseReferrerIdFromStartParam(verified.startParam),
      });
      req.tgUser = verified;
      next();
      return;
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
        ensureUser({
          telegramId: u.telegramId,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          isPremium: u.isPremium,
          referrerId: parseReferrerIdFromStartParam(u.startParam),
        });
        req.tgUser = u;
        next();
        return;
      }
    } catch {
      // fall through to browser demo user
    }
  }

  if (isDemoModeAllowed()) {
    const customDemoId = parseInt(
      (req.headers['x-demo-user-id'] as string | undefined) || '777001',
      10
    );
    const demoId = !Number.isNaN(customDemoId) && customDemoId > 0 ? customDemoId : 777001;
    const demoRef = parseReferrerIdFromStartParam(
      req.headers['x-demo-start-param'] as string | undefined
    );

    const demoNames: Record<number, { firstName: string; username: string; premium: boolean }> = {
      777001: { firstName: 'Demo Pioneer', username: 'pioneer_ton', premium: true },
      777002: { firstName: 'Invited Friend', username: 'friend_tester', premium: false },
    };
    const meta = demoNames[demoId] || {
      firstName: `Tester #${demoId}`,
      username: `tester_${demoId}`,
      premium: false,
    };

    ensureUser({
      telegramId: demoId,
      username: meta.username,
      firstName: meta.firstName,
      lastName: null,
      isPremium: meta.premium,
      referrerId: demoRef,
    });

    req.tgUser = {
      telegramId: demoId,
      username: meta.username,
      firstName: meta.firstName,
      lastName: null,
      isPremium: meta.premium,
      startParam: null,
      authMode: 'demo',
      isDemoAdmin: isDemoAdminId(demoId),
    };
    next();
    return;
  }

  res.status(401).json({
    error: 'Unauthorized. Please launch this Mini App from inside Telegram.',
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminHeaderSecret = (req.headers['x-admin-secret'] as string | undefined) || '';
  const configuredSecret = process.env.ADMIN_SECRET || '';

  if (configuredSecret && adminHeaderSecret && adminHeaderSecret === configuredSecret) {
    next();
    return;
  }

  if (req.tgUser) {
    if (isAdminTelegramId(req.tgUser.telegramId) || req.tgUser.isDemoAdmin) {
      next();
      return;
    }
  }

  res.status(403).json({
    error: 'Admin access required. Set your Telegram ID in ADMIN_IDS or enter ADMIN_SECRET.',
  });
}

import { Bot, InlineKeyboard, InputFile } from 'grammy';
import {
  buildUserState,
  claimDailyReward,
  claimMiningStorage,
  connectUserWallet,
  ensureUser,
  exportAirdropSnapshotCsv,
  getAdminStats,
  getAllRealTelegramUserIds,
  getLeaderboard,
  getSettings,
  isAdminTelegramId,
  updateSettings,
} from '../server/db.js';
import { getUserLeague, WALLET_CONNECT_BONUS } from '../shared/types.js';
import { parseTonAddress, shortenAddress } from '../shared/ton.js';

let botInstance: Bot | null = null;
let botRunning = false;
let botUsernameDetected: string | null = null;

// Track users waiting to paste a TON address or admin broadcast in chat
const awaitingWalletUsers = new Set<number>();

export function getBotStatus() {
  return {
    configured: Boolean(process.env.BOT_TOKEN),
    running: botRunning,
    username: botUsernameDetected || getSettings().botUsername,
    webAppUrl: getWebAppUrl(),
  };
}

export function getWebAppUrl(): string | null {
  const raw = (process.env.WEBAPP_URL || '').trim();
  if (raw && raw.startsWith('https://')) {
    return raw.replace(/\/$/, '');
  }
  return null;
}

export async function verifyTelegramChannelMembership(
  channelTarget: string,
  telegramUserId: number
): Promise<{ ok: boolean; reason?: string }> {
  if (!botInstance || !channelTarget.trim()) {
    // No live bot or target channel configured -> pass verification gracefully
    return { ok: true };
  }
  try {
    const target = channelTarget.trim();
    const member = await botInstance.api.getChatMember(target, telegramUserId);
    const allowedStatuses = ['creator', 'administrator', 'member', 'restricted'];
    if (allowedStatuses.includes(member.status)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `You haven't joined ${target} yet. Join the channel first, then tap Verify!`,
    };
  } catch (err) {
    console.warn('[Bot] getChatMember warning:', (err as Error).message);
    // If bot is not yet added as admin to that channel, don't block user unfairly
    return { ok: true };
  }
}

export async function broadcastMessageToUsers(
  messageText: string
): Promise<{ sent: number; failed: number }> {
  if (!botInstance) {
    throw new Error('Telegram BOT_TOKEN is not active.');
  }
  const userIds = getAllRealTelegramUserIds();
  let sent = 0;
  let failed = 0;

  for (const uid of userIds) {
    try {
      await botInstance.api.sendMessage(uid, messageText, { parse_mode: 'HTML' });
      sent++;
      // Respect Telegram ~25 msg/sec global broadcast limit
      await new Promise((r) => setTimeout(r, 45));
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

function buildMainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  const webAppUrl = getWebAppUrl();

  if (webAppUrl) {
    kb.webApp('🚀 Launch Airdrop Mini App', webAppUrl).row();
  }

  kb.text('🎁 Daily Claim', 'claim_daily')
    .text('⛏️ Harvest Mining', 'claim_mining')
    .row()
    .text('💎 TON Wallet', 'menu_wallet')
    .text('👥 Invite Friends', 'menu_invite')
    .row()
    .text('🏆 Leaderboard', 'menu_leaderboard')
    .text('📊 My Profile', 'menu_profile');

  return kb;
}

function formatDashboardText(telegramId: number): string {
  const state = buildUserState(telegramId, 'telegram');
  const { user, settings } = state;
  const league = getUserLeague(user.totalEarned);

  const walletBadge = user.walletAddress
    ? `✅ <code>${shortenAddress(user.walletAddress, 6)}</code>`
    : '⚠️ <i>Not connected yet</i>';

  const dailyBadge = user.canClaimDaily
    ? `🟢 <b>Ready! (+${user.nextDailyReward.toLocaleString()} $${settings.tokenSymbol})</b>`
    : `⏳ Claimed (Streak: ${user.dailyStreak}🔥)`;

  return [
    `💎 <b>${settings.tokenName} ($${settings.tokenSymbol}) — Official Airdrop</b>`,
    `<i>${settings.airdropPhase}</i>`,
    ``,
    `👤 <b>Explorer:</b> ${escapeHtml(user.firstName)} ${user.isPremium ? '⭐️' : ''}`,
    `🏅 <b>League:</b> ${league.current.badge} ${league.current.name} (Rank #${user.rank})`,
    `💰 <b>Balance:</b> <code>${user.balance.toLocaleString()}</code> <b>$${settings.tokenSymbol}</b>`,
    `⛏️ <b>Mining Vault:</b> <code>${user.miningPending.toLocaleString()} / ${user.miningCapacity.toLocaleString()}</code> (${user.miningRatePerHour}/hr)`,
    `🎁 <b>Daily Check-in:</b> ${dailyBadge}`,
    `👛 <b>TON Wallet:</b> ${walletBadge}`,
    `👥 <b>Referrals:</b> ${user.referralsCount} friends (+${user.referralEarnings.toLocaleString()} $${settings.tokenSymbol})`,
    ``,
    `Tap a button below or open the <b>Mini App</b> for Tap-to-Earn, Boosts & TON Connect!`,
  ].join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function startTelegramBot(): Promise<void> {
  const token = (process.env.BOT_TOKEN || '').trim();
  if (!token) {
    console.log(
      '[Bot] BOT_TOKEN is not set in .env — running Web Mini App & API in standalone/preview mode.'
    );
    return;
  }

  try {
    const bot = new Bot(token);
    botInstance = bot;

    const me = await bot.api.getMe();
    botUsernameDetected = me.username;
    updateSettings({ botUsername: me.username });

    await bot.api.setMyCommands([
      { command: 'start', description: '🚀 Launch Airdrop & Dashboard' },
      { command: 'claim', description: '🎁 Claim Daily Streak Reward' },
      { command: 'mine', description: '⛏️ Harvest Passive Mining Vault' },
      { command: 'wallet', description: '💎 Connect or View TON Wallet' },
      { command: 'invite', description: '👥 Invite Friends & Earn Commission' },
      { command: 'top', description: '🏆 Global Top 10 Leaderboard' },
      { command: 'admin', description: '🛠️ Admin Control Panel' },
    ]);

    const webAppUrl = getWebAppUrl();
    if (webAppUrl) {
      try {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: `🚀 Play $${getSettings().tokenSymbol}`,
            web_app: { url: webAppUrl },
          },
        });
      } catch (menuErr) {
        console.warn('[Bot] Could not set chat menu button:', (menuErr as Error).message);
      }
    }

    bot.command('start', async (ctx) => {
      if (!ctx.from) return;
      awaitingWalletUsers.delete(ctx.from.id);

      const payload = ctx.match?.trim() || '';
      let referrerId: number | null = null;
      if (payload.startsWith('ref_')) {
        const parsed = parseInt(payload.slice(4), 10);
        if (!Number.isNaN(parsed) && parsed > 0) referrerId = parsed;
      } else if (/^\d+$/.test(payload)) {
        referrerId = parseInt(payload, 10);
      }

      const result = ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name || 'Explorer',
        lastName: ctx.from.last_name || null,
        isPremium: Boolean(ctx.from.is_premium),
        referrerId,
      });

      const settings = getSettings();

      if (result.isNewUser && result.referrerRewardedId) {
        try {
          await bot.api.sendMessage(
            result.referrerRewardedId,
            `🎉 <b>New Referral Joined!</b>\n\n<b>${escapeHtml(
              ctx.from.first_name
            )}</b> joined using your invite link!\n💰 You earned <b>+${result.referrerBonusAmount.toLocaleString()} $${
              settings.tokenSymbol
            }</b> + ${settings.referralCommissionPct}% lifetime mining bonus!`,
            { parse_mode: 'HTML' }
          );
        } catch {
          // ignore if referrer blocked bot
        }
      }

      await ctx.reply(formatDashboardText(ctx.from.id), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(),
      });
    });

    bot.command('claim', async (ctx) => {
      if (!ctx.from) return;
      ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
        isPremium: Boolean(ctx.from.is_premium),
      });
      const settings = getSettings();
      try {
        const res = claimDailyReward(ctx.from.id);
        await ctx.reply(
          `🎁 <b>Daily Reward Claimed!</b>\n\n` +
            `➕ <b>+${res.reward.toLocaleString()} $${settings.tokenSymbol}</b> added to your balance!\n` +
            `🔥 Current Streak: <b>${res.newStreak} Day(s)</b>\n` +
            `⏰ Come back tomorrow after 00:00 UTC to keep your streak growing!`,
          { parse_mode: 'HTML', reply_markup: buildMainMenuKeyboard() }
        );
      } catch (err) {
        await ctx.reply(`⏳ ${(err as Error).message}`, {
          reply_markup: buildMainMenuKeyboard(),
        });
      }
    });

    bot.command('mine', async (ctx) => {
      if (!ctx.from) return;
      ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
        isPremium: Boolean(ctx.from.is_premium),
      });
      const settings = getSettings();
      try {
        const res = claimMiningStorage(ctx.from.id);
        await ctx.reply(
          `⛏️ <b>Mining Vault Harvested!</b>\n\n` +
            `➕ <b>+${res.claimed.toLocaleString()} $${settings.tokenSymbol}</b> collected!\n` +
            `Your quantum miner has restarted a fresh cycle.`,
          { parse_mode: 'HTML', reply_markup: buildMainMenuKeyboard() }
        );
      } catch (err) {
        await ctx.reply(`ℹ️ ${(err as Error).message}`, {
          reply_markup: buildMainMenuKeyboard(),
        });
      }
    });

    bot.command('wallet', async (ctx) => {
      if (!ctx.from) return;
      ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
      });
      const state = buildUserState(ctx.from.id, 'telegram');
      const kb = new InlineKeyboard();
      const wUrl = getWebAppUrl();
      if (wUrl) {
        kb.webApp('💎 Connect via TON Connect (Mini App)', `${wUrl}?tab=wallet`).row();
      }
      kb.text('📝 Paste TON Address in Chat', 'prompt_wallet_address')
        .row()
        .text('⬅️ Back to Dashboard', 'menu_home');

      await ctx.reply(
        `👛 <b>TON Wallet Configuration</b>\n\n` +
          (state.user.walletAddress
            ? `✅ <b>Connected Wallet:</b>\n<code>${state.user.walletAddress}</code>\nProvider: ${
                state.user.walletProvider || 'TON'
              }\n\nYou are eligible for the upcoming TGE Jetton distribution!`
            : `⚠️ <b>No TON wallet linked yet!</b>\n\nConnect via <b>TON Connect</b> (Tonkeeper / Telegram Wallet) inside the Mini App, or paste your non-custodial TON address (<code>UQ...</code>) right here.\n\n🎁 First-time connection reward: <b>+${WALLET_CONNECT_BONUS.toLocaleString()} $${
                state.settings.tokenSymbol
              }</b>!`),
        { parse_mode: 'HTML', reply_markup: kb }
      );
    });

    bot.command('invite', async (ctx) => {
      if (!ctx.from) return;
      ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
      });
      const { user, settings } = buildUserState(ctx.from.id, 'telegram');
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
        user.referralLink
      )}&text=${encodeURIComponent(
        `🚀 Join me on the ${settings.tokenName} ($${settings.tokenSymbol}) TON Airdrop and get a +2,500 token welcome bonus!`
      )}`;

      const kb = new InlineKeyboard()
        .url('📤 Share Invite Link', shareUrl)
        .row()
        .text('⬅️ Back to Dashboard', 'menu_home');

      await ctx.reply(
        `👥 <b>Invite Friends & Earn Big!</b>\n\n` +
          `🔹 Regular Friend: <b>+${settings.referralRewardRegular.toLocaleString()} $${settings.tokenSymbol}</b>\n` +
          `⭐️ Telegram Premium Friend: <b>+${settings.referralRewardPremium.toLocaleString()} $${settings.tokenSymbol}</b>\n` +
          `♾️ Lifetime Bonus: <b>+${settings.referralCommissionPct}%</b> of all their Daily & Mining claims!\n\n` +
          `📊 <b>Your Stats:</b> ${user.referralsCount} invited | <code>+${user.referralEarnings.toLocaleString()} $${settings.tokenSymbol}</code> earned\n\n` +
          `🔗 <b>Your Personal Link:</b>\n<code>${user.referralLink}</code>`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
    });

    bot.command('top', async (ctx) => {
      if (!ctx.from) return;
      ensureUser({
        telegramId: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
      });
      const state = buildUserState(ctx.from.id, 'telegram');
      const top = getLeaderboard(10);
      const medals = ['🥇', '🥈', '🥉'];

      const lines = top.map((entry, idx) => {
        const badge = medals[idx] || `#${entry.rank}`;
        const w = entry.walletConnected ? '💎' : '';
        return `${badge} <b>${escapeHtml(entry.firstName)}</b> ${w} — <code>${entry.totalEarned.toLocaleString()}</code> $${state.settings.tokenSymbol}`;
      });

      await ctx.reply(
        `🏆 <b>Global Top 10 Pioneers</b>\n\n` +
          lines.join('\n') +
          `\n\n📍 <b>Your Global Rank:</b> #${state.user.rank} (<code>${state.user.totalEarned.toLocaleString()}</code> $${state.settings.tokenSymbol})`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('⬅️ Back to Dashboard', 'menu_home'),
        }
      );
    });

    bot.command('admin', async (ctx) => {
      if (!ctx.from || !isAdminTelegramId(ctx.from.id)) {
        await ctx.reply('⛔️ You do not have admin permissions. Add your Telegram ID to ADMIN_IDS in .env.');
        return;
      }
      const stats = getAdminStats();
      const settings = getSettings();
      const kb = new InlineKeyboard()
        .text('📥 Export Snapshot CSV', 'admin_export_csv')
        .row()
        .text('🔄 Refresh Stats', 'admin_refresh');

      const wUrl = getWebAppUrl();
      if (wUrl) {
        kb.row().webApp('🛠️ Open Visual Admin Panel', `${wUrl}?tab=admin`);
      }

      await ctx.reply(
        `🛠️ <b>Admin Control Center — $${settings.tokenSymbol}</b>\n\n` +
          `👥 Total Accounts: <b>${stats.totalUsers.toLocaleString()}</b> (Real TG: ${stats.realUsers.toLocaleString()})\n` +
          `👛 Connected TON Wallets: <b>${stats.connectedWallets.toLocaleString()}</b>\n` +
          `🔥 Claimed Today (UTC): <b>${stats.claimedToday.toLocaleString()}</b>\n` +
          `✅ Tasks Completed: <b>${stats.tasksCompleted.toLocaleString()}</b>\n` +
          `💰 Circulating Balance: <code>${stats.circulatingBalance.toLocaleString()}</code> $${settings.tokenSymbol}\n\n` +
          `📣 <b>Broadcast Command:</b>\n<code>/broadcast Your HTML announcement here</code>`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
    });

    bot.command('broadcast', async (ctx) => {
      if (!ctx.from || !isAdminTelegramId(ctx.from.id)) {
        await ctx.reply('⛔️ Admin access required.');
        return;
      }
      const text = ctx.match?.trim();
      if (!text) {
        await ctx.reply('Usage: <code>/broadcast Hello Pioneers! Snapshot is coming!</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const statusMsg = await ctx.reply('📣 Broadcasting message to all users...');
      const res = await broadcastMessageToUsers(text);
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `✅ <b>Broadcast Complete!</b>\nDelivered: <b>${res.sent}</b> | Failed/Blocked: <b>${res.failed}</b>`,
        { parse_mode: 'HTML' }
      );
    });

    // Callback query handlers for Inline Keyboard buttons
    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const uid = ctx.from.id;

      ensureUser({
        telegramId: uid,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
        isPremium: Boolean(ctx.from.is_premium),
      });

      const settings = getSettings();

      if (data === 'menu_home' || data === 'menu_profile') {
        awaitingWalletUsers.delete(uid);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(formatDashboardText(uid), {
          parse_mode: 'HTML',
          reply_markup: buildMainMenuKeyboard(),
        }).catch(() => {});
        return;
      }

      if (data === 'claim_daily') {
        try {
          const res = claimDailyReward(uid);
          await ctx.answerCallbackQuery({
            text: `🎉 +${res.reward.toLocaleString()} $${settings.tokenSymbol} Claimed! Streak: ${res.newStreak}🔥`,
            show_alert: true,
          });
          await ctx.editMessageText(formatDashboardText(uid), {
            parse_mode: 'HTML',
            reply_markup: buildMainMenuKeyboard(),
          }).catch(() => {});
        } catch (err) {
          await ctx.answerCallbackQuery({
            text: `⏳ ${(err as Error).message}`,
            show_alert: true,
          });
        }
        return;
      }

      if (data === 'claim_mining') {
        try {
          const res = claimMiningStorage(uid);
          await ctx.answerCallbackQuery({
            text: `⛏️ Harvested +${res.claimed.toLocaleString()} $${settings.tokenSymbol}!`,
            show_alert: true,
          });
          await ctx.editMessageText(formatDashboardText(uid), {
            parse_mode: 'HTML',
            reply_markup: buildMainMenuKeyboard(),
          }).catch(() => {});
        } catch (err) {
          await ctx.answerCallbackQuery({
            text: `ℹ️ ${(err as Error).message}`,
            show_alert: true,
          });
        }
        return;
      }

      if (data === 'menu_wallet') {
        await ctx.answerCallbackQuery();
        const state = buildUserState(uid, 'telegram');
        const kb = new InlineKeyboard();
        const wUrl = getWebAppUrl();
        if (wUrl) {
          kb.webApp('💎 Open TON Connect (Mini App)', `${wUrl}?tab=wallet`).row();
        }
        kb.text('📝 Paste TON Address Here', 'prompt_wallet_address')
          .row()
          .text('⬅️ Back to Dashboard', 'menu_home');

        await ctx.editMessageText(
          `👛 <b>TON Wallet Status</b>\n\n` +
            (state.user.walletAddress
              ? `✅ Linked Wallet:\n<code>${state.user.walletAddress}</code>\nProvider: ${
                  state.user.walletProvider || 'TON'
                }`
              : `⚠️ Not connected yet.\nLink your Tonkeeper or Telegram Wallet to receive <b>+${WALLET_CONNECT_BONUS.toLocaleString()} $${settings.tokenSymbol}</b> instant bonus & qualify for the airdrop!`),
          { parse_mode: 'HTML', reply_markup: kb }
        ).catch(() => {});
        return;
      }

      if (data === 'prompt_wallet_address') {
        awaitingWalletUsers.add(uid);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `📥 <b>Send Your TON Wallet Address</b>\n\nPlease reply with your non-custodial TON wallet address (starts with <code>UQ...</code> or <code>EQ...</code> from Tonkeeper / MyTonWallet / Telegram Wallet):`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (data === 'menu_invite') {
        await ctx.answerCallbackQuery();
        const { user } = buildUserState(uid, 'telegram');
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
          user.referralLink
        )}&text=${encodeURIComponent(
          `🚀 Farm $${settings.tokenSymbol} with me on TON and claim your +2,500 welcome bonus!`
        )}`;
        const kb = new InlineKeyboard()
          .url('📤 Share Invite Link', shareUrl)
          .row()
          .text('⬅️ Back to Dashboard', 'menu_home');

        await ctx.editMessageText(
          `👥 <b>Referral Program</b>\n\n` +
            `• Regular Invite: <b>+${settings.referralRewardRegular.toLocaleString()} $${settings.tokenSymbol}</b>\n` +
            `• Premium Invite: <b>+${settings.referralRewardPremium.toLocaleString()} $${settings.tokenSymbol}</b>\n` +
            `• Commission: <b>+${settings.referralCommissionPct}%</b> of friends' claims!\n\n` +
            `Invited: <b>${user.referralsCount}</b> | Earned: <code>+${user.referralEarnings.toLocaleString()} $${settings.tokenSymbol}</code>\n\n` +
            `🔗 Your Link:\n<code>${user.referralLink}</code>`,
          { parse_mode: 'HTML', reply_markup: kb }
        ).catch(() => {});
        return;
      }

      if (data === 'menu_leaderboard') {
        await ctx.answerCallbackQuery();
        const state = buildUserState(uid, 'telegram');
        const top = getLeaderboard(10);
        const medals = ['🥇', '🥈', '🥉'];
        const lines = top.map(
          (e, i) =>
            `${medals[i] || `#${e.rank}`} <b>${escapeHtml(e.firstName)}</b> ${
              e.walletConnected ? '💎' : ''
            } — <code>${e.totalEarned.toLocaleString()}</code>`
        );
        await ctx.editMessageText(
          `🏆 <b>Global Leaderboard</b>\n\n${lines.join('\n')}\n\n📍 Your Rank: <b>#${
            state.user.rank
          }</b>`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text('⬅️ Back to Dashboard', 'menu_home'),
          }
        ).catch(() => {});
        return;
      }

      if (data === 'admin_export_csv') {
        if (!isAdminTelegramId(uid)) {
          await ctx.answerCallbackQuery({ text: 'Admin only', show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: 'Generating CSV snapshot...' });
        const csv = exportAirdropSnapshotCsv();
        const file = new InputFile(
          Buffer.from(csv, 'utf-8'),
          `airdrop_snapshot_${new Date().toISOString().slice(0, 10)}.csv`
        );
        await ctx.replyWithDocument(file, {
          caption: `📊 <b>$${settings.tokenSymbol} Airdrop Snapshot CSV</b>`,
          parse_mode: 'HTML',
        });
        return;
      }

      if (data === 'admin_refresh') {
        if (!isAdminTelegramId(uid)) {
          await ctx.answerCallbackQuery({ text: 'Admin only', show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: 'Refreshed!' });
        const stats = getAdminStats();
        await ctx.editMessageText(
          `🛠️ <b>Admin Control Center — $${settings.tokenSymbol}</b>\n\n` +
            `👥 Total Accounts: <b>${stats.totalUsers.toLocaleString()}</b> (Real TG: ${stats.realUsers.toLocaleString()})\n` +
            `👛 Connected TON Wallets: <b>${stats.connectedWallets.toLocaleString()}</b>\n` +
            `🔥 Claimed Today (UTC): <b>${stats.claimedToday.toLocaleString()}</b>\n` +
            `✅ Tasks Completed: <b>${stats.tasksCompleted.toLocaleString()}</b>\n` +
            `💰 Circulating Balance: <code>${stats.circulatingBalance.toLocaleString()}</code> $${settings.tokenSymbol}`,
          {
            parse_mode: 'HTML',
            reply_markup: ctx.callbackQuery.message?.reply_markup,
          }
        ).catch(() => {});
        return;
      }

      await ctx.answerCallbackQuery();
    });

    // Direct TON address paste listener
    bot.on('message:text', async (ctx) => {
      if (!ctx.from) return;
      const text = ctx.message.text.trim();
      const uid = ctx.from.id;

      const looksLikeTon =
        awaitingWalletUsers.has(uid) ||
        /^(UQ|EQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(text) ||
        /^(-1|0):[0-9a-fA-F]{64}$/.test(text);

      if (!looksLikeTon) return;

      ensureUser({
        telegramId: uid,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name,
      });

      const parsed = parseTonAddress(text);
      if (!parsed) {
        await ctx.reply(
          `❌ <b>Invalid TON Address</b>\nPlease double-check your address (it should be a 48-character <code>UQ...</code> or <code>EQ...</code> address with valid TON checksum).`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      try {
        const res = connectUserWallet(uid, text, 'Telegram Bot Direct');
        awaitingWalletUsers.delete(uid);
        const settings = getSettings();
        const bonusLine =
          res.bonusAwarded > 0
            ? `\n🎁 <b>+${res.bonusAwarded.toLocaleString()} $${settings.tokenSymbol}</b> first-time wallet bonus credited!`
            : '';
        await ctx.reply(
          `✅ <b>TON Wallet Linked Successfully!</b>\n\nAddress: <code>${res.friendlyAddress}</code>${bonusLine}`,
          { parse_mode: 'HTML', reply_markup: buildMainMenuKeyboard() }
        );
      } catch (err) {
        await ctx.reply(`⚠️ ${(err as Error).message}`);
      }
    });

    bot.catch((err) => {
      console.error('[Bot] Runtime error:', err.message);
    });

    bot.start({
      onStart: (info) => {
        botRunning = true;
        console.log(`[Bot] Telegram Bot @${info.username} is live and polling!`);
      },
    });
  } catch (err) {
    console.error('[Bot] Failed to initialize Telegram Bot:', (err as Error).message);
  }
}

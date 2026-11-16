# 💎 NovaTON — Telegram Airdrop Bot + TON Mini App

A production-ready **Telegram Airdrop platform** with a full graphical **TON Mini App**, an inline-keyboard **Telegram Bot**, embedded **SQLite** persistence, TON wallet linking (TON Connect + verified manual address), and an integrated **web admin panel**.

> Token name, symbol, bonuses and phase labels are all editable at runtime from the Admin tab — the code ships with the placeholder token **NovaTON ($NOVA)**.

---

## ✨ Features

### 🎮 Player Mini App (English UI)
| Tab | What it does |
| --- | --- |
| **Mine** | Tap-to-Earn orb with floating `+X` particles, energy bar with passive regen, 7-day escalating daily streak check-in, 24/7 passive mining vault with live interpolation + Harvest button, league progress (Bronze → Diamond), live rank, balance. |
| **Boosts** | Quantum Miner (hourly rate), Vault Duration (4h → 24h storage), Multitap (+2/tap per level), Energy Capacitor (+500 max energy per level), 3 free daily energy refills. Exponential cost curves, 15 levels each. |
| **Quests** | Channel joins (server-side `getChatMember` verification), social links, wallet-connect task, invite-count and streak milestones. Open → Verify → instant reward. |
| **Squad** | Personal referral link `t.me/<bot>?start=ref_<id>`, one-tap copy & Telegram share, squad list with your lifetime commission cut, live global leaderboard with medals. |
| **Wallet** | TON Connect 2.0 (Tonkeeper / MyTonWallet / Tonhub / Telegram Wallet) **plus** manual TON address entry with CRC16-XMODEM checksum validation. +5,000 token first-link bonus, one-wallet-per-account anti-sybil, Tonviewer link, unlink. |
| **Admin** (admins only) | Live stats, quest publisher, user search, balance adjust, ban/unban, Telegram broadcast, CSV airdrop snapshot, token & referral settings. |

### 🤖 Telegram Bot (grammY)
- `/start` with `ref_<id>` payload → auto-attribution + instant bonus to the referrer (with a DM notification).
- Inline dashboard: 🚀 Launch Mini App (Web App button), 🎁 Daily Claim, ⛏️ Harvest, 💎 Wallet, 👥 Invite, 🏆 Top 10, 📊 Profile.
- Chat-menu button opens the Mini App; `/wallet` lets users **paste a TON address directly into the chat** (validated + linked).
- `/admin` — stats, CSV export (sent as a document), `/broadcast <html>` with rate-limiting to respect Telegram's ~25 msg/s limit.
- `/claim`, `/mine`, `/invite`, `/top` shortcuts.

### 🛡️ Security & correctness
- **HMAC-SHA256 `initData` verification** (`secret = HMAC_SHA256("WebAppData", bot_token)`) with `timingSafeEqual` on the hash — no unsigned requests are trusted when `BOT_TOKEN` is set.
- Full **TON address codec**: raw `0:<hex>` ↔ friendly `UQ…/EQ…`, workchain handling, base64url, CRC16-XMODEM checksum, testnet flag.
- One TON wallet ⇢ one Telegram account (anti-farming) + per-user balance transaction ledger.
- Server-authoritative economy: taps are clamped by remaining energy, mining is capped by vault capacity, streaks reset on missed UTC days.

---

## 🚀 Quick start

```bash
npm install          # Node.js 22+ required (uses built-in node:sqlite)
cp .env.example .env # then edit the values
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000` — with no `BOT_TOKEN` you land in **Demo Sandbox mode** (test account `777001` = admin, `777002` = regular user), so every feature is playable immediately.

```bash
npm run typecheck    # zero-error TypeScript check (client + server)
npm run build        # vite build  → dist/client, tsc → dist/server
npm start            # production server (NODE_ENV=production)
```

### Environment variables (`.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | for production | Token from [@BotFather](https://t.me/BotFather). Enables bot polling + real `initData` verification. |
| `BOT_USERNAME` | recommended | Bot username **without `@`** (used for referral links & fallback). |
| `WEBAPP_URL` | for production | Public **HTTPS** URL of this app (e.g. `https://airdrop.example.com`). Also used as the TON Connect manifest origin. |
| `ADMIN_IDS` | recommended | Comma-separated numeric Telegram IDs with admin rights, e.g. `123456789,987654321`. |
| `ADMIN_SECRET` | optional | Extra header secret (`X-Admin-Secret`) to unlock the admin panel from a browser. |
| `ALLOW_DEMO_MODE` | optional | `true` (default) keeps the sandbox account available; set `false` to require real Telegram auth. |
| `PORT` | optional | Server port (default `3000`). |
| `TOKEN_NAME`, `TOKEN_SYMBOL` | optional | Initial token branding (also editable in the Admin tab). |

---

## 📱 Connecting the bot to Telegram

1. **Create the bot** with BotFather → copy the token into `BOT_TOKEN`.
2. **Expose the app over HTTPS** (Telegram requires HTTPS for Mini Apps):
   ```bash
   ngrok http 3000     # or cloudflared tunnel / a real domain + reverse proxy
   ```
   Put the HTTPS URL in `WEBAPP_URL` and restart. `allowedHosts: true` is already set in Vite, so ngrok/Cloudflare hostnames work out of the box.
3. **Register the Mini App**: in BotFather → `/newapp` (or Bot Settings → Menu Button) and point it at `WEBAPP_URL`. The bot also calls `setChatMenuButton` automatically on startup.
4. **Channel-join quests**: add the bot as an **administrator** of the channel you verify, then create a quest with verification type `telegram_channel` and `targetValue = @yourchannel`. If the bot cannot read membership it fails open (never blocks honest users).
5. Send `/start` to your bot → the dashboard appears → tap **🚀 Launch Airdrop Mini App**.

### TON Connect
`GET /tonconnect-manifest.json` is generated dynamically (`url`, `name`, `iconUrl` from the live request/origin + current token settings), so it works on localhost, ngrok and production domains without edits. Inside Telegram the provider is initialized with `twaReturnUrl` so the wallet app returns to the Mini App after approval.

**Manual fallback:** if TON Connect cannot open a wallet inside the WebView, users paste their `UQ…`/`EQ…` address in the Wallet tab (or straight into the bot chat) — the server decodes it, verifies the CRC16 checksum, stores both friendly and raw forms.

---

## 🗂️ Project structure

```
src/
├── shared/
│   ├── ton.ts              # TON raw/friendly address codec + CRC16-XMODEM
│   └── types.ts            # DTOs, boost catalog/cost curves, streak rewards, leagues
├── server/
│   ├── db.ts               # node:sqlite engine: users, mining, taps, daily streak,
│   │                       # boosts, tasks, wallet linking, referrals, leaderboard, admin
│   ├── auth.ts             # initData HMAC verification, demo sandbox auth, admin guard
│   └── index.ts            # Express API + TON Connect manifest + Vite (dev) / static (prod)
├── bot/
│   └── index.ts            # grammY bot: commands, inline menu, channel check, broadcast
└── client/
    ├── main.tsx            # React root + TonConnectUIProvider
    ├── App.tsx             # tab shell, demo banner, toasts
    ├── api.ts              # typed API client, Telegram WebApp helpers, haptics
    └── components/         # HomeTab, BoostsTab, TasksTab, FriendsTab, WalletTab, AdminTab
```

Data lives in `data/airdrop.db` (WAL mode, created & seeded automatically, git-ignored).

---

## 🔌 API reference

All `/api/*` routes require the `X-Telegram-Init-Data` header (real mode) or fall back to the demo account (`X-Demo-User-Id`, default `777001`).

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + bot status |
| `GET` | `/api/state` | Full user state, settings, bot status |
| `POST` | `/api/claim-daily` | Daily streak claim |
| `POST` | `/api/claim-mining` | Harvest passive mining |
| `POST` | `/api/tap` | Batch taps `{ taps }` (clamped by energy) |
| `POST` | `/api/refill-energy` | Free daily refill |
| `POST` | `/api/boosts/upgrade` | `{ boostType: multitap \| energy_limit \| mining_rig \| storage_tank }` |
| `POST` | `/api/wallet/connect` | `{ address, provider }` |
| `POST` | `/api/wallet/disconnect` | Unlink wallet |
| `GET` | `/api/tasks` · `POST /api/tasks/:id/claim` | Quest list / claim (with channel verification) |
| `GET` | `/api/referrals` · `/api/leaderboard` · `/api/transactions` | Social data |
| `GET` | `/api/admin/overview` | Stats, settings, quests, users |
| `PUT` | `/api/admin/settings` | Update token / referral config |
| `POST`/`PATCH`/`DELETE` | `/api/admin/tasks[/:id]` | Quest CRUD / toggle |
| `POST` | `/api/admin/users/:id/adjust` · `/ban` | Balance adjust, ban/unban |
| `POST` | `/api/admin/broadcast` | Telegram broadcast |
| `GET` | `/api/admin/export-csv` | Airdrop snapshot CSV |

Admin routes accept either a Telegram ID listed in `ADMIN_IDS`, the demo admin (`777001` when demo mode is on), or the `X-Admin-Secret` header matching `ADMIN_SECRET`.

---

## 🧮 Economy defaults (all tweakable in code / admin panel)

- Daily streak: `500 → 1,000 → 1,800 → 3,000 → 5,000 → 7,500 → 12,000` (day 7 = jackpot, cycle repeats).
- Passive mining: level 1 = `120/hr`, vault capacity = `rate × storage hours` (4h → 24h).
- Tap: `+2` per multitap level, energy starts at `500` and regenerates `2/sec`.
- Referral: `+2,500` regular / `+5,000` Telegram Premium, plus `10%` lifetime commission on every friend claim.
- Wallet link: `+5,000` once per account (one wallet per account).
- Leagues: Bronze `0` → Silver `10k` → Gold `50k` → Platinum `200k` → Diamond `750k`.

---

## 📦 Airdrop snapshot

`GET /api/admin/export-csv` (Admin tab → **CSV**) or the bot's `/admin` → **📥 Export Snapshot CSV** produce:

```
telegram_id,username,first_name,ton_wallet_friendly,ton_wallet_raw,token_balance,total_earned,daily_streak,referrals_count
```

Balances are spendable in-game (boost purchases) while `total_earned` tracks lifetime farming — use it for the distribution weighting.

---

## 🧪 Sandbox notes

- Demo mode is on unless `ALLOW_DEMO_MODE=false`. Two sandbox accounts: `777001` (admin) and `777002` (regular) — switchable from the banner inside the Mini App.
- The **Squad** tab has a *Simulate a Friend Joining* button that creates a fresh sandbox account attributed to your referral code, so you can test bonuses and commission without a second phone.
- With `BOT_TOKEN` set, the bot's broadcast / channel checks are live; without it the API returns a clear error instead of failing silently.

---

## ☁️ Free hosting options (no server of your own)

The app only needs **one always-on Node process reachable over public HTTPS** — that is what Telegram Mini Apps and the bot's long polling require. It does **not** need a VPS you administer if one of these free tiers fits:

| Option | Cost | Real HTTPS URL | Persistence | Verdict |
| --- | --- | --- | --- | --- |
| **Cloudflare Tunnel / ngrok + your PC** | Free | ✅ | ✅ (local SQLite file) | Fastest way to *test* inside Telegram; your computer must stay on. |
| **GitHub Codespaces** | Free 60h/month (2-core) | ✅ (set port visibility → Public) | ✅ while the codespace lives | Great for a no-PC-required **test**, not for a running campaign. |
| **Render (free web service, this repo ships `render.yaml`)** | Free | ✅ | ❌ ephemeral disk (resets on redeploy/sleep) | Works for a **demo/pilot**; keep it awake with a 5-min uptime ping and export the CSV often. |
| **Koyeb / Hugging Face Spaces (Docker)** | Free tier | ✅ | ❌ ephemeral unless paid volume | Same trade-off as Render. |
| **Oracle Cloud Always Free VM** (or GCP free `e2-micro`) | Free forever | ✅ (+ Caddy for TLS) | ✅ real disk | **Best free option for a real airdrop** — a permanent box, SQLite on disk, bot always online. Needs a card for identity verification. |
| Vercel / Netlify | Free | ✅ | ❌ | ❌ Serverless: no long-running bot polling, no persistent SQLite. |
| Cloudflare Workers + D1 | Free | ✅ | ✅ | ❌ Would need a rewrite of the DB layer + webhook mode. |

### Deploy on Render in ~2 minutes (free)
1. Push this repo to GitHub, then on [render.com](https://render.com) → **New → Blueprint** → select the repo (it picks up `render.yaml`).
2. Wait for the Docker build → copy the `https://<name>.onrender.com` URL.
3. In **Environment**, set `BOT_TOKEN`, `ADMIN_IDS`, and `WEBAPP_URL` (the onrender URL) → redeploy.
4. Set the Mini App URL in BotFather (`/newapp`) and add an uptime pinger (UptimeRobot, 5 min) on `/api/health` so the free instance and the bot stay awake.
   ⚠️ On the free plan the disk is wiped on redeploy — do not run a real token distribution on it; use a free VM instead.

### Deploy on a free VM (permanent, recommended)

The repo ships a **one-shot bootstrap** (`deploy/setup.sh`) for a fresh Ubuntu 22.04/24.04 VM — it installs Node 22 + Caddy, hardens the firewall, clones this repo, builds it, and registers a systemd service with auto-HTTPS:

```bash
# on the VM, after you have its public IP:
git clone -b arena/ca6f6f6e-bot https://github.com/vahidvnm/bot.git && cd bot
sudo bash deploy/setup.sh <your-domain>     # e.g. bot.example.com  or  1.2.3.4.sslip.io
nano /opt/ton-airdrop/.env                  # BOT_TOKEN, WEBAPP_URL=https://<domain>, ADMIN_IDS, ALLOW_DEMO_MODE=false
sudo systemctl restart ton-airdrop
# later updates:
sudo bash /opt/ton-airdrop/deploy/update.sh
```

Files used: `deploy/setup.sh` (bootstrap), `deploy/Caddyfile` (auto-HTTPS reverse proxy), `deploy/ton-airdrop.service` (systemd unit), `deploy/update.sh` (pull + rebuild + restart).

Point a free domain/subdomain (DuckDNS, or `<ip>.sslip.io` with zero signup) at the VM; open **TCP 22/80/443** in the cloud firewall. Caddy obtains the Let's Encrypt certificate automatically. SQLite stays on the VM's disk — set `DATABASE_PATH` if you prefer a dedicated volume.

### Docker (any host)
```bash
docker build -t ton-airdrop .
docker run -d -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" ton-airdrop
```

---

## 🚢 Deployment checklist

1. Node.js **22+** (for `node:sqlite`) behind a reverse proxy with HTTPS.
2. `npm ci && npm run build && NODE_ENV=production npm start`.
3. Set `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `ADMIN_IDS`, and `ALLOW_DEMO_MODE=false`.
4. Persist `data/` as a volume (SQLite) and back it up before each snapshot.
5. Register the Mini App URL in BotFather and add the bot as channel admin for join quests.

---

## 🇮🇷 راهنمای سریع (فارسی)

```bash
npm install
cp .env.example .env
npm run dev
```

- توکن ربات را از [@BotFather](https://t.me/BotFather) بگیرید و در `BOT_TOKEN` بگذارید.
- برنامه باید روی یک آدرس **HTTPS** عمومی بالا باشد (ngrok یا دامنه‌ی خودتان) و همان آدرس در `WEBAPP_URL` قرار بگیرد.
- آیدی عددی تلگرام خودتان را در `ADMIN_IDS` بنویسید تا پنل ادمین باز شود.
- بدون `BOT_TOKEN` برنامه در حالت **Demo Sandbox** اجرا می‌شود و همه‌ی امکانات (کلیم روزانه، ماینینگ، تپ، boosts، رفرال، کیف پول TON، پنل ادمین) قابل تست هستند.
- برای کوئست‌های «عضویت در کانال»، ربات را ادمین همان کانال کنید و در پنل ادمین نوع تأیید را `telegram_channel` با مقدار `@channel` بگذارید.
- **سرور خودتان لازم نیست:** یا با «تونل رایگان» (cloudflared/ngrok) از کامپیوتر خودتان اجرا کنید، یا همین مخزن را روی **Render** (فایل `render.yaml` آماده است) یا یک **VM رایگان Oracle Always Free** بالا بیاورید. جدول مقایسه‌ی گزینه‌های رایگان در بخش «☁️ Free hosting options» آمده است. توجه: پلن رایگان Render دیسک دائمی ندارد و با هر ری‌دیپلوی دیتابیس صفر می‌شود؛ برای ایردراپ واقعی VM رایگان انتخاب بهتری است.

---

## ☁️ راه‌اندازی رایگان روی Oracle Cloud (گزینهی پیشنهادی برای ایردراپ واقعی)

**بله — باید یک‌جا ثبت‌نام کنید:** در [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) با ایمیل حساب بسازید. مراحل:

1. **ثبت‌نام:** ایمیل، نام و آدرس (آدرس باید مطابق کارت باشد) → تأیید ایمیل.
2. **احراز هویت با کارت:** ویزا/مسترکارت (دبیت هم قبول است) لازم است تا هویتتان تأیید شود. یک مبلغ کوچک موقتاً رزرو و بلافاصله برگردانده میشود؛ **شارژ نمیشود**. ⚠️ بدون کارت، ثبت‌نام ممکن نیست — در این حالت از تونل رایگان یا Render استفاده کنید.
3. **طرح:** ۳۰ روز اعتبار ۳۰۰ دلاری میگیرید؛ بعد از ۳۰ روز حساب **خودکار به Always Free تبدیل میشود** و تا وقتی فقط از منابع رایگان استفاده کنید، پولی کم نمیشود.
   منابع رایگان همیشگی: تا **۴ هستهی ARM + ۲۴ گیگ رم** (یا ۲ عدد VM کوچک AMD)، چند صد گیگ دیسک و ~۱۰ ترابایت ترافیک خروجی در ماه — برای این ربات بیش از کافی است.
4. **ساخت ماشین (VM):** Console → Compute → Instances → Create →
   - **منطقه (Region):** نزدیک به کاربرانتان (مثلاً Frankfurt یا Amsterdam)؛ منطقه را بعداً نمیتوان عوض کرد.
   - **Shape:** `VM.Standard.A1.Flex` با ۱–۲ هسته و ۲–۴ گیگ رم (رایگان).
   - **سیستمعامل:** Ubuntu 22.04 یا 24.04.
   - **SSH Key:** یک کلید بسازید (یا فایل کلیدتان را بگذارید) تا با `ssh` وارد شوید.
   - در **Security List / Inbound Rules** پورت‌های **22، 80 و 443** را باز کنید.
5. **راه‌اندازی با یک دستور** (روی VM، بعد از ورود با SSH):
   ```bash
   sudo bash deploy/setup.sh <domain>
   # مثال بدون خرید دامنه:  sudo bash deploy/setup.sh 1.2.3.4.sslip.io
   ```
   این اسکریپت همه‌چیز را نصب میکند: Node 22، Caddy با HTTPS خودکار، فایروال، بیلد پروژه، سرویس systemd و فایل `.env`.
6. سپس:
   ```bash
   nano /opt/ton-airdrop/.env     # BOT_TOKEN، WEBAPP_URL=https://<domain>، ADMIN_IDS، ALLOW_DEMO_MODE=false
   sudo systemctl restart ton-airdrop
   ```
   و در BotFather آدرس `https://<domain>` را به‌عنوان Mini App بدهید.

**به‌روزرسانی بعدی:**
```bash
sudo bash /opt/ton-airdrop/deploy/update.sh
```
**لاگ‌ها:**
```bash
journalctl -u ton-airdrop -f
```

⚠️ دو نکته: (۱) پورت‌های امنیتی Oracle را در کنسول خودش هم باز کنید، وگرنه Caddy گواهی نمیگیرد. (۲) منابع Always Free برای استفادهی عادی کافی است، ولی اگر منابع زیادی آزاد کنید ممکن است اوراکل آنها را مصادره کند؛ همین ۱–۲ هسته ثابت بگذارید.

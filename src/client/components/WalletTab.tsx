import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  ShieldCheck,
  Unlink,
  Wallet,
} from 'lucide-react';
import { TonConnectButton, useTonAddress, useTonWallet } from '@tonconnect/ui-react';
import type { UserStateResponse } from '../../shared/types.js';
import { WALLET_CONNECT_BONUS } from '../../shared/types.js';
import { parseTonAddress, shortenAddress } from '../../shared/ton.js';
import { api, openExternalOrTelegramLink, triggerHaptic } from '../api.js';

interface WalletTabProps {
  data: UserStateResponse;
  onStateUpdate: (next: UserStateResponse) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export const WalletTab: React.FC<WalletTabProps> = ({
  data,
  onStateUpdate,
  showToast,
}) => {
  const { user, settings } = data;
  const tonAddress = useTonAddress();
  const tonWallet = useTonWallet();

  const [manualAddress, setManualAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoLinkedRef = useRef<string | null>(null);

  const linkWallet = async (address: string, provider: string) => {
    setBusy(true);
    try {
      const res = await api.connectWallet(address, provider);
      triggerHaptic('success');
      onStateUpdate(res.state);
      const bonus =
        res.walletResult.bonusAwarded > 0
          ? ` +${res.walletResult.bonusAwarded.toLocaleString()} $${settings.tokenSymbol} bonus!`
          : '';
      showToast(`✅ TON wallet linked successfully!${bonus}`, 'success');
    } catch (err) {
      triggerHaptic('error');
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Auto-link freshly connected TON Connect wallet to the player's account
  useEffect(() => {
    if (!tonAddress) return;
    if (user.walletAddress) return;
    if (autoLinkedRef.current === tonAddress) return;
    autoLinkedRef.current = tonAddress;
    void linkWallet(tonAddress, tonWallet?.device?.appName || 'TON Connect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tonAddress, user.walletAddress]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTonAddress(manualAddress);
    if (!parsed) {
      triggerHaptic('error');
      showToast('Invalid TON address. Must be a valid 48-char UQ…/EQ… address.', 'error');
      return;
    }
    await linkWallet(manualAddress.trim(), 'Manual Address Entry');
    setManualAddress('');
  };

  const handleDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.disconnectWallet();
      onStateUpdate(res.state);
      showToast('Wallet unlinked from your airdrop account.', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!user.walletAddress) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopied(true);
      showToast('Address copied!', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Copy failed', 'error');
    }
  };

  const manualParsed = parseTonAddress(manualAddress);

  return (
    <div className="space-y-4 pb-6">
      {/* Wallet Status Hero */}
      <div
        className={`rounded-2xl border p-4 ${
          user.walletAddress
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 via-slate-900 to-teal-950/40'
            : 'border-amber-500/30 bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              user.walletAddress
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            <Wallet className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-extrabold text-white">
                {user.walletAddress ? 'TON Wallet Linked' : 'Connect Your TON Wallet'}
              </h2>
              {user.walletAddress && <Check className="h-4 w-4 text-emerald-400" />}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
              {user.walletAddress
                ? `Linked via ${user.walletProvider || 'TON'}. Your ${settings.tokenSymbol} airdrop drop will be sent to this address at TGE.`
                : `Required for the airdrop snapshot. First-time link rewards you +${WALLET_CONNECT_BONUS.toLocaleString()} $${settings.tokenSymbol}.`}
            </p>

            {user.walletAddress && (
              <div className="mt-2.5 flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 p-1.5 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-200">
                  {shortenAddress(user.walletAddress, 8)}
                </span>
                <button
                  onClick={handleCopyAddress}
                  className="shrink-0 rounded-lg bg-white/10 p-1.5 text-slate-200 transition hover:bg-white/20"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={() =>
                    openExternalOrTelegramLink(
                      `https://tonviewer.com/${user.walletAddress}`
                    )
                  }
                  className="shrink-0 rounded-lg bg-white/10 p-1.5 text-slate-200 transition hover:bg-white/20"
                  title="View on Tonviewer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {user.walletAddress && (
              <div className="mt-1.5 text-[10px] text-slate-400">
                Raw: <span className="font-mono">{shortenAddress(user.walletRawAddress || '', 6)}</span>
                {user.walletBonusClaimed && (
                  <span className="ml-2 text-emerald-400">
                    ✓ +{WALLET_CONNECT_BONUS.toLocaleString()} bonus claimed
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {user.walletAddress && (
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-50"
          >
            <Unlink className="h-3.5 w-3.5" />
            Unlink wallet from account
          </button>
        )}
      </div>

      {/* TON Connect */}
      <div className="rounded-2xl border border-sky-500/25 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-sky-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Option 1 — TON Connect (Recommended)
          </h3>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          Works with Tonkeeper, MyTonWallet, Tonhub and Telegram Wallet. Tap the button,
          pick your wallet app and approve the secure read-only session. We never ask for
          seed phrases or private keys.
        </p>

        <div className="mt-3 flex justify-center">
          <TonConnectButton className="!w-full [&>button]:!w-full" />
        </div>

        {tonAddress && (
          <div className="mt-2.5 rounded-xl border border-sky-500/20 bg-sky-500/10 p-2.5 text-[11px] text-sky-200">
            <div className="font-semibold text-sky-300">Detected wallet:</div>
            <div className="mt-0.5 truncate font-mono">{tonAddress}</div>
            {user.walletAddress !== tonAddress && !busy && (
              <button
                onClick={() =>
                  linkWallet(tonAddress, tonWallet?.device?.appName || 'TON Connect')
                }
                className="mt-2 flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-slate-950"
              >
                Link this wallet <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {busy && (
          <div className="mt-2 animate-pulse text-center text-[11px] text-sky-300">
            Verifying & linking wallet on server...
          </div>
        )}
      </div>

      {/* Manual Address */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Option 2 — Paste TON Address Manually
          </h3>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          If TON Connect cannot open your wallet inside Telegram, copy your non-custodial
          address from Tonkeeper / Telegram Wallet and paste it below. Checksum is verified
          on our server.
        </p>

        <form onSubmit={handleManualSubmit} className="mt-3 space-y-2">
          <input
            type="text"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="UQ... or 0:..."
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500/60"
          />
          {manualAddress.trim().length > 0 && (
            <div
              className={`text-[10px] font-semibold ${
                manualParsed ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {manualParsed
                ? `✓ Valid TON address (workchain ${manualParsed.workchain})`
                : '✗ Invalid checksum or format'}
            </div>
          )}
          <button
            type="submit"
            disabled={!manualParsed || busy}
            className={`w-full rounded-xl py-2.5 text-xs font-extrabold transition ${
              manualParsed && !busy
                ? 'bg-white text-slate-950 hover:bg-slate-200 active:scale-[0.99]'
                : 'cursor-not-allowed bg-white/10 text-slate-500'
            }`}
          >
            {busy ? 'Linking...' : 'Verify & Link Address'}
          </button>
        </form>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <p className="text-[10px] leading-relaxed text-slate-400">
          <b className="text-slate-300">Non-custodial & read-only.</b> Connecting a wallet
          never grants spending permission. One wallet can only be linked to one Telegram
          account to prevent airdrop farming. Unlink anytime above.
        </p>
      </div>
    </div>
  );
};

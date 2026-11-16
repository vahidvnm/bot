/**
 * Authentic TON Address parser, validator, and formatter (Raw 0:hex <-> Friendly UQ.../EQ...)
 * Implements TON's official 36-byte structure + CRC16-XMODEM checksum.
 */

function crc16Xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_');
}

function base64ToBytes(str: string): Uint8Array | null {
  try {
    const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
    if (normalized.length !== 48) return null;
    if (typeof atob === 'function') {
      const bin = atob(normalized);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  } catch {
    return null;
  }
}

export interface ParsedTonAddress {
  raw: string; // e.g. "0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8"
  friendly: string; // Non-bounceable UQ... (standard TON wallet format)
  bounceable: string; // Bounceable EQ...
  workchain: number;
  isTestnet: boolean;
}

export function encodeFriendlyTonAddress(
  workchain: number,
  hashBytes: Uint8Array,
  options: { bounceable?: boolean; testnet?: boolean } = {}
): string {
  if (hashBytes.length !== 32) {
    throw new Error('TON hash must be 32 bytes');
  }
  let tag = options.bounceable ? 0x11 : 0x51;
  if (options.testnet) {
    tag |= 0x80;
  }
  const addrBytes = new Uint8Array(36);
  addrBytes[0] = tag;
  addrBytes[1] = workchain === -1 ? 0xff : workchain & 0xff;
  addrBytes.set(hashBytes, 2);

  const crc = crc16Xmodem(addrBytes.subarray(0, 34));
  addrBytes[34] = (crc >> 8) & 0xff;
  addrBytes[35] = crc & 0xff;

  return bytesToBase64Url(addrBytes);
}

export function parseTonAddress(input: string): ParsedTonAddress | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Case 1: Raw format "<workchain>:<64-hex-chars>"
  const rawMatch = /^(-1|0):([0-9a-fA-F]{64})$/.exec(trimmed);
  if (rawMatch) {
    const workchain = parseInt(rawMatch[1], 10);
    const hex = rawMatch[2].toLowerCase();
    const hashBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      hashBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return {
      raw: `${workchain}:${hex}`,
      friendly: encodeFriendlyTonAddress(workchain, hashBytes, { bounceable: false }),
      bounceable: encodeFriendlyTonAddress(workchain, hashBytes, { bounceable: true }),
      workchain,
      isTestnet: false,
    };
  }

  // Case 2: 48-char User-Friendly format (EQ..., UQ..., kQ..., 0Q...)
  const decoded = base64ToBytes(trimmed);
  if (!decoded || decoded.length !== 36) return null;

  const tag = decoded[0];
  const validTags = [0x11, 0x51, 0x91, 0xd1];
  if (!validTags.includes(tag)) return null;

  const wcByte = decoded[1];
  if (wcByte !== 0x00 && wcByte !== 0xff) return null;
  const workchain = wcByte === 0xff ? -1 : 0;

  const expectedCrc = crc16Xmodem(decoded.subarray(0, 34));
  const actualCrc = (decoded[34] << 8) | decoded[35];
  if (expectedCrc !== actualCrc) return null;

  const hashBytes = decoded.subarray(2, 34);
  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += hashBytes[i].toString(16).padStart(2, '0');
  }
  const isTestnet = (tag & 0x80) !== 0;

  return {
    raw: `${workchain}:${hex}`,
    friendly: encodeFriendlyTonAddress(workchain, hashBytes, {
      bounceable: false,
      testnet: isTestnet,
    }),
    bounceable: encodeFriendlyTonAddress(workchain, hashBytes, {
      bounceable: true,
      testnet: isTestnet,
    }),
    workchain,
    isTestnet,
  };
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

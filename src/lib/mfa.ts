import crypto from 'crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function computeTotpCode(secretBase32: string, timestampMs = Date.now(), stepSec = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, token: string, windowSteps = 1, timestampMs = Date.now()): boolean {
  const clean = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (let w = -windowSteps; w <= windowSteps; w++) {
    const candidate = computeTotpCode(secretBase32, timestampMs + w * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))) {
      return true;
    }
  }
  return false;
}

function deriveEncryptionKey(): Buffer {
  const rawKey =
    process.env.MFA_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'dev-mfa-fallback-key-bloomar-local';
  return crypto.createHash('sha256').update(`bloomar-mfa:${rawKey}`).digest();
}

export function encryptMfaSecret(plainBase32: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBase32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptMfaSecret(stored: string): string {
  if (!stored.startsWith('v1:')) return stored;
  const [, ivHex, tagHex, encHex] = stored.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return plain.toString('utf8');
}

export function generateRecoveryCodes(count = 8): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plain.push(formatted);
    hashes.push(hashRecoveryCode(formatted));
  }
  return { plain, hashes };
}

export function hashRecoveryCode(code: string): string {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(`bloomar-recovery:${normalized}`).digest('hex');
}

export function formatSetupKey(secretBase32: string): string {
  const cleaned = String(secretBase32 || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
}

export function buildOtpAuthUri(
  email: string,
  secretBase32: string,
  issuer = 'BloomAR Manager'
): string {
  const encIssuer = encodeURIComponent(issuer);
  const encAccount = encodeURIComponent(email.trim().toLowerCase());
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${encodeURIComponent(
    secretBase32
  )}&issuer=${encIssuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function generateMfaQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 240,
    color: {
      dark: '#0F2D52',
      light: '#FFFFFF',
    },
  });
}

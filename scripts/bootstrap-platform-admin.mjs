/**
 * One-time platform-admin bootstrap. Credentials come ONLY from environment
 * variables — never commit real emails/passwords to this repo.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="..."; $env:PLATFORM_ADMIN_EMAIL="you@example.com"
 *   $env:PLATFORM_ADMIN_TEMP_PASSWORD="..."; npm run bootstrap:admin
 * Usage (bash):
 *   DATABASE_URL=... PLATFORM_ADMIN_EMAIL=you@example.com \
 *   PLATFORM_ADMIN_TEMP_PASSWORD='...' npm run bootstrap:admin
 *
 * - Creates the user if missing (administrator role, verified, active)
 * - Otherwise promotes the existing user and, only if
 *   PLATFORM_ADMIN_TEMP_PASSWORD is set, resets their password (bcrypt)
 * - Always revokes existing sessions after a password reset
 * - Change the temporary password immediately after first sign-in
 *   (Account Settings -> Security & Sessions)
 */
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); dotenv.config();

function buildConfig(rawUrl) {
  let s = rawUrl.trim().replace(/^(?:DATABASE_URL_POOLED|NEON_DATABASE_URL|DATABASE_URL)\s*=\s*/i, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  s = s.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/gi, '$1').replace(/&amp;/gi, '&');
  let sslMode = null;
  let channelBinding = null;
  let isNeon = false;
  try {
    const u = new URL(s);
    sslMode = u.searchParams.get('sslmode');
    channelBinding = u.searchParams.get('channel_binding');
    isNeon = u.hostname.endsWith('.neon.tech');
    if ((sslMode === 'require' || sslMode === 'prefer') && !u.searchParams.has('uselibpqcompat') && !u.searchParams.has('sslrootcert')) {
      u.searchParams.set('uselibpqcompat', 'true');
    }
    s = u.toString();
  } catch {
    if (s.includes('sslmode=require')) sslMode = 'require';
    if (s.includes('channel_binding=require')) channelBinding = 'require';
    isNeon = s.includes('.neon.tech');
  }
  const needsSsl = sslMode !== 'disable' && (Boolean(sslMode) || isNeon);
  return {
    connectionString: s,
    ...(needsSsl && sslMode !== 'verify-full' && sslMode !== 'verify-ca' ? { ssl: { rejectUnauthorized: false } } : {}),
    ...(needsSsl && (channelBinding === 'require' || channelBinding === 'prefer') ? { enableChannelBinding: true } : {}),
  };
}

const email = (process.env.PLATFORM_ADMIN_EMAIL || '').toLowerCase().trim();
const tempPassword = process.env.PLATFORM_ADMIN_TEMP_PASSWORD || '';
const firstName = process.env.PLATFORM_ADMIN_FIRST_NAME || 'Platform';
const lastName = process.env.PLATFORM_ADMIN_LAST_NAME || 'Admin';
const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED || process.env.NEON_DATABASE_URL;
if (!url) { console.error('DATABASE_URL, DATABASE_URL_POOLED, or NEON_DATABASE_URL is required.'); process.exit(1); }
if (!email || !/^\S+@\S+\.\S+$/.test(email)) { console.error('PLATFORM_ADMIN_EMAIL must be a valid email (set it privately, do not commit it).'); process.exit(1); }
if (tempPassword && tempPassword.length < 10) { console.error('PLATFORM_ADMIN_TEMP_PASSWORD must be at least 10 characters.'); process.exit(1); }

const pool = new Pool(buildConfig(url));
try {
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (rows.length === 0) {
    if (!tempPassword) { console.error('User does not exist yet and no PLATFORM_ADMIN_TEMP_PASSWORD was given — set one privately to create the account.'); process.exit(1); }
    const hash = await bcrypt.hash(tempPassword, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, is_platform_admin, account_status, email_verified_at)
       VALUES ($1,$2,$3,$4,'administrator',true,true,'active',now())`,
      [email, hash, firstName, lastName]);
    console.log('Platform admin account created and verified. Sign in, then change the temporary password immediately.');
  } else {
    const id = rows[0].id;
    if (tempPassword) {
      const hash = await bcrypt.hash(tempPassword, 12);
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
      await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      console.log('Password reset applied and existing sessions revoked.');
    }
    await pool.query(
      `UPDATE users SET is_platform_admin=true, is_active=true, account_status='active',
       email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [id]);
    console.log('Existing user promoted to platform admin (active + verified).');
  }
} finally { await pool.end(); }

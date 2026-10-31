import type { PoolConfig } from 'pg';

export type ExtendedPoolConfig = PoolConfig & {
  enableChannelBinding?: boolean;
};

/**
 * Clean common copy-paste artifacts from Postgres connection strings
 * (wrapping quotes, accidental KEY= prefix, HTML &amp;, markdown mailto links)
 * and ensure pg-connection-string uses libpq-compatible sslmode=require semantics
 * without emitting Node deprecation warnings.
 */
export function normalizeDatabaseUrl(raw: string, opts?: { direct?: boolean }): string {
  let s = raw.trim();

  // Strip accidental ENV_KEY= prefix if pasted into a hosting dashboard Value box
  s = s.replace(/^(?:DATABASE_URL_POOLED|NEON_DATABASE_URL|DATABASE_URL)\s*=\s*/i, '').trim();

  // Strip matching outer quotes ("..." or '...')
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // Unwrap accidental markdown mailto links from rich-text copy/paste: [pass@host](mailto:pass@host) -> pass@host
  s = s.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/gi, '$1');

  // Decode HTML-escaped ampersands in query parameters
  s = s.replace(/&amp;/gi, '&');

  try {
    const parsed = new URL(s);
    if (opts?.direct && parsed.hostname.includes('-pooler.')) {
      parsed.hostname = parsed.hostname.replace('-pooler.', '.');
    }
    const sslmode = parsed.searchParams.get('sslmode');
    if (
      (sslmode === 'require' || sslmode === 'prefer') &&
      !parsed.searchParams.has('uselibpqcompat') &&
      !parsed.searchParams.has('sslrootcert')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
    }
    return parsed.toString();
  } catch {
    // Fallback if URL cannot be parsed by WHATWG URL
    if (opts?.direct) {
      s = s.replace(/-pooler\./g, '.');
    }
    return s;
  }
}

/**
 * Runtime pool URL priority:
 * 1. DATABASE_URL_POOLED (Neon's pooled connection string, ideal for serverless)
 * 2. DATABASE_URL (standard primary DB URL — takes precedence over any stale NEON_DATABASE_URL)
 * 3. NEON_DATABASE_URL (legacy/integration fallback)
 */
export function resolveRuntimeDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const raw = env.DATABASE_URL_POOLED || env.DATABASE_URL || env.NEON_DATABASE_URL;
  return raw && raw.trim() ? raw : undefined;
}

/**
 * Direct (unpooled) URL priority for DDL / schema migrations:
 * 1. DATABASE_URL (usually unpooled when paired with DATABASE_URL_POOLED)
 * 2. DATABASE_URL_POOLED (with -pooler stripped from hostname)
 * 3. NEON_DATABASE_URL (with -pooler stripped from hostname)
 */
export function resolveDirectDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const raw = env.DATABASE_URL || env.DATABASE_URL_POOLED || env.NEON_DATABASE_URL;
  return raw && raw.trim() ? raw : undefined;
}

/**
 * Build a node-postgres Pool configuration supporting Neon TLS + SCRAM-SHA-256-PLUS
 * channel binding (`channel_binding=require`).
 */
export function buildPgPoolConfig(
  rawUrl: string,
  opts?: { direct?: boolean; max?: number; connectionTimeoutMillis?: number }
): ExtendedPoolConfig {
  const connectionString = normalizeDatabaseUrl(rawUrl, { direct: opts?.direct });

  let sslMode: string | null = null;
  let channelBinding: string | null = null;
  let isNeonHost = false;

  try {
    const parsed = new URL(connectionString);
    sslMode = parsed.searchParams.get('sslmode');
    channelBinding = parsed.searchParams.get('channel_binding');
    isNeonHost = parsed.hostname.endsWith('.neon.tech');
  } catch {
    if (connectionString.includes('sslmode=require')) sslMode = 'require';
    if (connectionString.includes('channel_binding=require')) channelBinding = 'require';
    isNeonHost = connectionString.includes('.neon.tech');
  }

  const disableSsl = sslMode === 'disable';
  const needsSsl = !disableSsl && (Boolean(sslMode) || isNeonHost);
  const enableChannelBinding =
    needsSsl && (channelBinding === 'require' || channelBinding === 'prefer');

  const config: ExtendedPoolConfig = {
    connectionString,
    connectionTimeoutMillis: opts?.connectionTimeoutMillis ?? 15_000,
  };

  if (opts?.max !== undefined) {
    config.max = opts.max;
  }

  if (needsSsl && sslMode !== 'verify-full' && sslMode !== 'verify-ca') {
    config.ssl = { rejectUnauthorized: false };
  }

  if (enableChannelBinding) {
    config.enableChannelBinding = true;
  }

  return config;
}

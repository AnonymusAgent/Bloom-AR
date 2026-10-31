import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSaaSColumns, safeErrorDetail } from "@/lib/db-schema";

export const dynamic = "force-dynamic";

/** Diagnostics without secrets: DB reachability + automatic schema bootstrap on empty Neon DBs. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const schema = await ensureSaaSColumns();
    const cols = await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('email_verified_at','is_platform_admin','account_status')`
    );
    const present = (cols.rows as { column_name: string }[]).map((r) => r.column_name);
    return Response.json(
      {
        ok: schema.ok && present.length === 3,
        database: 'reachable',
        schema: {
          ready: schema.ok && present.length === 3,
          bootstrapped: Boolean(schema.bootstrapped),
          usersColumnsPresent: present,
          missingTables: schema.missingTables,
        },
        hint: schema.ok
          ? undefined
          : 'Run "npm run db:migrate" with DATABASE_URL set (or apply drizzle/*.sql in order), then re-check.',
      },
      { status: schema.ok ? 200 : 503 }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        database: 'unreachable',
        detail: safeErrorDetail(error),
        hint: 'Check DATABASE_URL / DATABASE_URL_POOLED in the hosting environment (and remove any stale NEON_DATABASE_URL), ensure the database is active, then redeploy.',
      },
      { status: 500 }
    );
  }
}

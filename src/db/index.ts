import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { ensureSchema } from "./migrate";

export type AppDb = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let db: AppDb | null = null;
let migratePromise: Promise<void> | null = null;
let unavailableLogged = false;

/** True when DATABASE_URL is configured (does not mean DB is reachable). */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Lazy Postgres client. Returns null when DATABASE_URL is missing or connect/migrate fails.
 * Callers must degrade gracefully — guests / localStorage still work.
 */
export async function getDb(): Promise<AppDb | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  if (db) return db;

  try {
    if (!client) {
      client = postgres(url, {
        max: 5,
        idle_timeout: 20,
        connect_timeout: 8,
        // Railway / serverless-friendly
        prepare: false,
      });
    }
    const instance = drizzle(client, { schema });
    if (!migratePromise) {
      migratePromise = ensureSchema(client).catch((err) => {
        migratePromise = null;
        throw err;
      });
    }
    await migratePromise;
    db = instance;
    return db;
  } catch (err) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      console.warn(
        "[no3-darts] Postgres unavailable — player accounts disabled until DATABASE_URL works:",
        err instanceof Error ? err.message : err
      );
    }
    // Reset so a later request can retry after John attaches Postgres
    try {
      await client?.end({ timeout: 1 });
    } catch {
      /* ignore */
    }
    client = null;
    db = null;
    migratePromise = null;
    return null;
  }
}

export { schema };

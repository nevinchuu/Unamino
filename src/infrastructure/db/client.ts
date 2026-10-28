import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  /** Closes the connections. Tests and scripts call this so the process can exit. */
  readonly close: () => Promise<void>;
}

const DEFAULT_MAX_CONNECTIONS = 5;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Connects to Postgres. Supabase's pooler is reached over TLS, so it is required for any non-local host.
 * Prepared statements are off so the same code also works behind the pooler's transaction mode.
 */
export function connectDatabase(url: string, maxConnections: number = DEFAULT_MAX_CONNECTIONS): DatabaseHandle {
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  const client = postgres(url, { max: maxConnections, prepare: false, ssl: local ? false : "require" });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

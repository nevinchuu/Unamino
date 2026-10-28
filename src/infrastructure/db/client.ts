import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveDatabaseSsl, type TlsSettings } from "./ssl";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  /** Closes the connections. Tests and scripts call this so the process can exit. */
  readonly close: () => Promise<void>;
}

const DEFAULT_MAX_CONNECTIONS = 5;

/**
 * Connects to Postgres. Supabase's pooler is reached over TLS, so it is required for any non-local host, and with the
 * provider's CA certificate the server's identity is checked too. Throws, naming the setting, if the TLS settings are
 * unusable, so a server never starts on a link it was told to verify but cannot.
 * Prepared statements are off so the same code also works behind the pooler's transaction mode.
 */
export function connectDatabase(url: string, maxConnections: number = DEFAULT_MAX_CONNECTIONS, tls: TlsSettings = {}): DatabaseHandle {
  const ssl = resolveDatabaseSsl(new URL(url).hostname, tls);
  if (!ssl.ok) throw new Error(ssl.error);
  const client = postgres(url, { max: maxConnections, prepare: false, ssl: ssl.value });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

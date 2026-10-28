import { rootCertificates } from "node:tls";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { connectDatabase } from "./client";

/**
 * Runs against the real database, so it is skipped unless asked for, and it needs the CA certificate that signed that
 * database's certificate:
 *   DB_TESTS=1 DATABASE_SSL_CA="$(cat ca.pem)" node --env-file=.env.local node_modules/vitest/vitest.mjs run postgres-tls
 * It checks that the connection works when verified against the right authority and is refused against another.
 */
const url = process.env.DATABASE_URL;
const ca = process.env.DATABASE_SSL_CA;
const ENABLED = process.env.DB_TESTS === "1" && Boolean(url) && Boolean(ca);

async function reaches(caCertificate: string): Promise<boolean> {
  const handle = connectDatabase(url as string, 1, { caCertificate, requireVerification: true });
  try {
    // A bare query is enough to prove the link came up.
    await handle.db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

describe.skipIf(!ENABLED)("the database link, verified", () => {
  it("connects when the certificate matches the authority it was given", async () => {
    expect(await reaches(ca as string)).toBe(true);
  }, 30_000);

  it("refuses to connect when the certificate was signed by some other authority", async () => {
    expect(await reaches(rootCertificates[0])).toBe(false);
  }, 30_000);
});

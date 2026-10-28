import { err, ok, type Result } from "@/lib/result";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PEM_START = "-----BEGIN CERTIFICATE-----";

/**
 * "require": the link is encrypted, but nobody checks who is on the other end, so someone in the middle could pose as
 * the database. The object form checks the server's certificate against the given authority.
 */
export type DatabaseSsl = false | "require" | { readonly ca: string; readonly rejectUnauthorized: true };

export interface TlsSettings {
  /** The certificate authority that signed the database's certificate, as PEM text. `\n` written out in one line is accepted too, for settings that cannot hold line breaks. */
  readonly caCertificate?: string | null;
  /** True in production: a link that cannot be verified is then refused rather than quietly accepted. */
  readonly requireVerification?: boolean;
}

/** Turns the setting into PEM text. Null when there is none, "invalid" when it is something else. */
function readCertificate(value: string | null | undefined): string | null | "invalid" {
  const text = value?.replace(/\n/g, "\n").trim();
  if (!text) return null;
  return text.includes(PEM_START) ? text : "invalid";
}

/**
 * How to connect to the database: not encrypted for this machine, verified against the given authority when there is
 * one, and otherwise encrypted but unverified, which production refuses. The message never holds the certificate.
 */
export function resolveDatabaseSsl(hostname: string, tls: TlsSettings = {}): Result<DatabaseSsl, string> {
  if (LOCAL_HOSTS.has(hostname)) return ok(false);

  const ca = readCertificate(tls.caCertificate);
  if (ca === "invalid") return err("DATABASE_SSL_CA is not a PEM certificate. It should start with -----BEGIN CERTIFICATE-----");
  if (ca) return ok({ ca, rejectUnauthorized: true });
  if (tls.requireVerification) {
    return err("DATABASE_SSL_CA is needed in production: without it the database's identity is not checked. Set it to the CA certificate from your database provider.");
  }
  return ok("require");
}

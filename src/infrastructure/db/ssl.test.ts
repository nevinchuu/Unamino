import { describe, expect, it } from "vitest";
import { resolveDatabaseSsl } from "./ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";

describe("resolveDatabaseSsl", () => {
  it("does not use TLS for this machine, whatever else is set", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(resolveDatabaseSsl(host, { requireVerification: true })).toEqual({ ok: true, value: false });
  });

  it("checks the server's certificate against the authority when one is given", () => {
    expect(resolveDatabaseSsl("db.example.com", { caCertificate: PEM })).toEqual({ ok: true, value: { ca: PEM, rejectUnauthorized: true } });
  });

  it("accepts the certificate written on one line with \n, as an environment setting often has to be", () => {
    const oneLine = PEM.replace(/\n/g, "\n");
    expect(resolveDatabaseSsl("db.example.com", { caCertificate: oneLine })).toEqual({ ok: true, value: { ca: PEM, rejectUnauthorized: true } });
  });

  it("still encrypts, without checking who answers, when nothing was given and verification is not required", () => {
    expect(resolveDatabaseSsl("db.example.com")).toEqual({ ok: true, value: "require" });
    expect(resolveDatabaseSsl("db.example.com", { caCertificate: "   " })).toEqual({ ok: true, value: "require" });
  });

  it("refuses an unverified link in production, and says which setting to give", () => {
    const result = resolveDatabaseSsl("db.example.com", { requireVerification: true });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain("DATABASE_SSL_CA");
  });

  it("refuses a setting that is not a certificate, without repeating what was given", () => {
    const result = resolveDatabaseSsl("db.example.com", { caCertificate: "hunter2-not-a-cert" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("uses the certificate even in production, which is how production gets through", () => {
    expect(resolveDatabaseSsl("db.example.com", { caCertificate: PEM, requireVerification: true })).toMatchObject({ ok: true, value: { rejectUnauthorized: true } });
  });
});

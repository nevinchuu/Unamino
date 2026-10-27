import { describe, expect, it } from "vitest";
import { readServerEnv, resolveHoldSimulation } from "./env";

const FULL = { DATABASE_URL: "postgres://x", LITEAPI_KEY: "lite", MUSE_SPARK_API_KEY: "muse" };

describe("readServerEnv", () => {
  it("reads the required settings and leaves the optional ones empty", () => {
    const env = readServerEnv(FULL);
    expect(env).toMatchObject({ ok: true, value: { databaseUrl: "postgres://x", liteApiKey: "lite", placesApiKey: null, cronSecret: null } });
  });

  it("reads the optional settings when present, trimmed", () => {
    const env = readServerEnv({ ...FULL, GOOGLE_PLACES_API_KEY: "  places ", CRON_SECRET: " secret " });
    expect(env).toMatchObject({ ok: true, value: { placesApiKey: "places", cronSecret: "secret" } });
  });

  it("treats blank values as missing", () => {
    expect(readServerEnv({ ...FULL, GOOGLE_PLACES_API_KEY: "   " })).toMatchObject({ ok: true, value: { placesApiKey: null } });
  });

  it("names every required setting that is missing, and nothing else", () => {
    const env = readServerEnv({ LITEAPI_KEY: "lite", DATABASE_URL: "   " });
    expect(env).toEqual({ ok: false, error: { missing: ["DATABASE_URL", "MUSE_SPARK_API_KEY"] } });
  });

  it("never puts a value in the error", () => {
    const env = readServerEnv({ LITEAPI_KEY: "super-secret-value" });
    expect(JSON.stringify(env)).not.toContain("super-secret-value");
  });
});

describe("hold simulation", () => {
  it("is off unless SIMULATE_HOLDS is exactly 1", () => {
    expect(readServerEnv(FULL)).toMatchObject({ ok: true, value: { simulateHolds: false } });
    expect(readServerEnv({ ...FULL, SIMULATE_HOLDS: "1" })).toMatchObject({ ok: true, value: { simulateHolds: true } });
    for (const other of ["true", "yes", "0", "", "2"]) expect(readServerEnv({ ...FULL, SIMULATE_HOLDS: other })).toMatchObject({ ok: true, value: { simulateHolds: false } });
  });

  it("is allowed when developing and testing, and refused in production", () => {
    expect(resolveHoldSimulation(true, "development")).toEqual({ ok: true, value: true });
    expect(resolveHoldSimulation(true, "test")).toEqual({ ok: true, value: true });
    expect(resolveHoldSimulation(true, undefined)).toEqual({ ok: true, value: true });
    expect(resolveHoldSimulation(true, "production")).toEqual({ ok: false, error: { message: "SIMULATE_HOLDS must not be set in production" } });
  });

  it("is always fine to leave off, even in production", () => {
    expect(resolveHoldSimulation(false, "production")).toEqual({ ok: true, value: false });
  });
});

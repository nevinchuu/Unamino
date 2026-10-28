import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { MIN_CRON_SECRET_LENGTH } from "./cron-auth";
import { handleExpireOverdue, OVERDUE_BATCH, type CronDeps } from "./cron-handler";

const SECRET = "s".repeat(MIN_CRON_SECRET_LENGTH);
const NOW = new Date("2026-10-27T12:00:00Z");
const SUMMARY = { checked: 3, expired: 1, renewed: 1, ended: 1, left: 0 };

function setup(overrides: Partial<CronDeps> = {}) {
  const calls: [Date, number][] = [];
  const deps: CronDeps = {
    secret: SECRET,
    now: () => NOW,
    service: { expireOverdue: async (now, limit) => (calls.push([now, limit]), ok(SUMMARY)) },
    ...overrides,
  };
  return { deps, calls };
}

const request = (authorization?: string) => new Request("http://localhost/api/cron/expire-overdue", { headers: authorization ? { authorization } : {} });

afterEach(() => vi.restoreAllMocks());

describe("handleExpireOverdue", () => {
  it("runs the sweep for the scheduler and returns what it did", async () => {
    const { deps, calls } = setup();
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUMMARY);
    expect(calls).toEqual([[NOW, OVERDUE_BATCH]]);
  });

  it("also settles stuck bookings and says what it did", async () => {
    const sweeps: number[] = [];
    const { deps } = setup({ bookings: { sweep: async (limit) => (sweeps.push(limit), { settled: 1, cancelled: 2, failed: 0 }) } });
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), deps);
    expect(await response.json()).toEqual({ ...SUMMARY, booking: { settled: 1, cancelled: 2, failed: 0 } });
    expect(sweeps).toEqual([OVERDUE_BATCH]);
  });

  it("also deletes details kept too long, and says how many", async () => {
    const calls: Date[] = [];
    const { deps } = setup({ travellers: { purgeStale: async (now) => (calls.push(now), ok(3)) } });
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), deps);
    expect(await response.json()).toEqual({ ...SUMMARY, travellersPurged: 3 });
    expect(calls).toEqual([NOW]);
  });

  it("still answers when the purge could not run", async () => {
    const { deps } = setup({ travellers: { purgeStale: async () => err({ kind: "unavailable" }) } });
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUMMARY);
  });

  it.each([undefined, "Bearer wrong"])("refuses %j without running anything", async (header) => {
    const { deps, calls } = setup();
    const response = await handleExpireOverdue(request(header), deps);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses every call when no secret is configured", async () => {
    const { deps, calls } = setup({ secret: null });
    const response = await handleExpireOverdue(request("Bearer anything"), deps);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("answers with a plain error and logs only the kind when the sweep fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = setup({ service: { expireOverdue: async () => err({ kind: "prices_stale", message: "internal detail" }) } });
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "sweep_failed" });
    expect(log).toHaveBeenCalledWith("expire-overdue failed", "prices_stale");
  });

  it("is never cached", async () => {
    const response = await handleExpireOverdue(request(`Bearer ${SECRET}`), setup().deps);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

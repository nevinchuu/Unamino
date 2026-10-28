import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_CRON_SECRET_LENGTH } from "./cron-auth";
import { handleRetryEffects, type RetryCronDeps } from "./retry-handler";

const SECRET = "r".repeat(MIN_CRON_SECRET_LENGTH);
const SUMMARY = { tried: 3, succeeded: 2, failed: 1, gaveUp: 0 };
const request = (authorization?: string) => new Request("http://localhost/api/cron/retry-effects", { headers: authorization ? { authorization } : {} });

function setup(overrides: Partial<RetryCronDeps> = {}) {
  let runs = 0;
  const deps: RetryCronDeps = { secret: SECRET, retrier: { retry: async () => (runs += 1, SUMMARY) }, ...overrides };
  return { deps, runs: () => runs };
}

afterEach(() => vi.restoreAllMocks());

describe("handleRetryEffects", () => {
  it("runs the retry for the scheduler and returns what it did", async () => {
    const { deps, runs } = setup();
    const response = await handleRetryEffects(request(`Bearer ${SECRET}`), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUMMARY);
    expect(runs()).toBe(1);
  });

  it.each([undefined, "Bearer wrong", SECRET])("refuses %j without running anything", async (header) => {
    const { deps, runs } = setup();
    expect((await handleRetryEffects(request(header), deps)).status).toBe(401);
    expect(runs()).toBe(0);
  });

  it("has nothing to do, and says so, on a server without real card holds", async () => {
    const response = await handleRetryEffects(request(`Bearer ${SECRET}`), { secret: SECRET, retrier: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tried: 0, skipped: "no_real_payments" });
  });

  it("answers a failure plainly and keeps its detail to the logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = setup({ retrier: { retry: async () => { throw new Error("postgres://secret connection refused"); } } });
    const response = await handleRetryEffects(request(`Bearer ${SECRET}`), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("retry-effects failed");
  });

  it("is never cached", async () => {
    expect((await handleRetryEffects(request(`Bearer ${SECRET}`), setup().deps)).headers.get("cache-control")).toBe("no-store");
  });
});

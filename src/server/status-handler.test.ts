import { afterEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import type { PlanStatusReader } from "@/domain/plan/status-reader";
import { handlePlanStatus } from "./status-handler";

const ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const DEADLINE = new Date("2026-10-27T12:09:00Z");

const found: PlanStatusReader = { read: async () => ok({ status: "approving", memberCount: 4, agreedCount: 4, approvedCount: 2, deadlineAt: DEADLINE }) };

afterEach(() => vi.restoreAllMocks());

describe("handlePlanStatus", () => {
  it("shows the state and the counts, and nothing else", async () => {
    const response = await handlePlanStatus(ID, found);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "approving", members: 4, agreed: 4, approved: 2, deadlineAt: DEADLINE.toISOString() });
  });

  it("answers a plan that does not exist and a malformed id the same way, without asking the store about the latter", async () => {
    let asked = 0;
    const missing: PlanStatusReader = { read: async () => (asked += 1, err({ code: "not_found", message: "no" })) };
    const unknown = await handlePlanStatus(ID, missing);
    const malformed = await handlePlanStatus("not-a-uuid'; drop table plans;--", missing);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await unknown.json()).toEqual(await malformed.json());
    expect(asked).toBe(1);
  });

  it("says the service is unavailable when the store cannot be reached, and logs only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down: PlanStatusReader = { read: async () => err({ code: "unavailable", message: "connection string postgres://secret" }) };
    const response = await handlePlanStatus(ID, down);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("plan status failed", "unavailable");
  });

  it("is never cached", async () => {
    expect((await handlePlanStatus(ID, found)).headers.get("cache-control")).toBe("no-store");
  });
});

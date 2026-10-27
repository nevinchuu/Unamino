import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "./apply-event";
import type { PlanRepository, RepositoryError, StoredPlan } from "./repository";
import type { MemberSnapshot, PlanEvent, PlanSnapshot } from "./types";

const T0 = new Date("2026-10-27T00:00:00Z");
const DEADLINE = new Date("2026-10-27T00:09:00Z");
const HARD = new Date("2026-10-29T00:00:00Z");

const member = (id: string, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  id,
  planAgreement: "pending",
  agreedShareMinor: null,
  approval: "pending",
  approvedMinor: null,
  currentShareMinor: null,
  chargedMinor: null,
  approvalExpiresAt: null,
  holdPlaced: false,
  ...overrides,
});

const reviewing = (): PlanSnapshot => ({ status: "reviewing", deadlineAt: DEADLINE, hardDeadlineAt: HARD, members: [member("ana"), member("ben")] });
const agree = (memberId: string): PlanEvent => ({ type: "plan_agreed", at: T0, memberId, shareMinor: 20000 });

/** A plan store in memory that enforces the version rule, with a hook to simulate someone else saving first. */
class MemoryRepository implements PlanRepository {
  saves = 0;
  loads = 0;
  constructor(
    public stored: StoredPlan | null,
    private readonly beforeSave: (repo: MemoryRepository, attempt: number) => void = () => undefined,
    private readonly saveFailure: RepositoryError | null = null,
  ) {}

  async load(): Promise<Result<StoredPlan, RepositoryError>> {
    this.loads += 1;
    return this.stored ? ok(this.stored) : err({ code: "not_found", message: "no plan" });
  }

  async save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>> {
    this.saves += 1;
    this.beforeSave(this, this.saves);
    if (this.saveFailure) return err(this.saveFailure);
    if (!this.stored || this.stored.version !== stored.version) return err({ code: "version_conflict", message: "changed" });
    this.stored = { id: stored.id, version: stored.version + 1, plan: next };
    return ok(this.stored);
  }
}

const storedAt = (plan: PlanSnapshot, version = 1): StoredPlan => ({ id: "plan-1", version, plan });

describe("applyPlanEvent", () => {
  it("applies the event, saves it at the next version, and returns what to do next", async () => {
    const repo = new MemoryRepository(storedAt(reviewing()));
    const result = await applyPlanEvent(repo, "plan-1", agree("ana"));
    expect(result.ok && result.value.version).toBe(2);
    expect(result.ok && result.value.plan.members[0].planAgreement).toBe("agreed");
    expect(repo.stored?.version).toBe(2);
  });

  it("returns the effects of the last agreement", async () => {
    const repo = new MemoryRepository(storedAt({ ...reviewing(), members: [member("ana", { planAgreement: "agreed", agreedShareMinor: 20000 }), member("ben")] }));
    const result = await applyPlanEvent(repo, "plan-1", agree("ben"));
    expect(result.ok && result.value.plan.status).toBe("approving");
    expect(result.ok && result.value.effects).toEqual([{ type: "request_approval", memberIds: ["ana", "ben"] }]);
  });

  it("returns a refused transition and saves nothing", async () => {
    const repo = new MemoryRepository(storedAt(reviewing()));
    const result = await applyPlanEvent(repo, "plan-1", { type: "booking_started", at: T0 });
    expect(!result.ok && result.error.kind === "transition" && result.error.error.code).toBe("invalid_status");
    expect(repo.saves).toBe(0);
  });

  it("reads the plan again after a collision and applies the event to what is there now", async () => {
    // While Ana's agreement is being saved, Ben's lands first.
    const repo = new MemoryRepository(storedAt(reviewing()), (self, attempt) => {
      if (attempt === 1 && self.stored) {
        const ben = self.stored.plan.members.map((m) => (m.id === "ben" ? { ...m, planAgreement: "agreed" as const, agreedShareMinor: 20000 } : m));
        self.stored = { ...self.stored, version: 2, plan: { ...self.stored.plan, members: ben } };
      }
    });
    const result = await applyPlanEvent(repo, "plan-1", agree("ana"));
    expect(result.ok && result.value.version).toBe(3);
    // Both agreements survived, so the plan moved on to step 2.
    expect(result.ok && result.value.plan.status).toBe("approving");
    expect(repo.loads).toBe(2);
  });

  it("does not apply an event that is no longer valid after the plan changed underneath it", async () => {
    const repo = new MemoryRepository(storedAt(reviewing()), (self, attempt) => {
      if (attempt === 1 && self.stored) self.stored = { ...self.stored, version: 2, plan: { ...self.stored.plan, status: "expired" } };
    });
    const result = await applyPlanEvent(repo, "plan-1", agree("ana"));
    expect(!result.ok && result.error.kind === "transition" && result.error.error.code).toBe("plan_closed");
    expect(repo.stored?.plan.status).toBe("expired");
  });

  it("gives up after the attempt limit when the plan keeps changing", async () => {
    let version = 1;
    const repo = new MemoryRepository(storedAt(reviewing()), (self) => {
      version += 1;
      if (self.stored) self.stored = { ...self.stored, version };
    });
    const result = await applyPlanEvent(repo, "plan-1", agree("ana"), 3);
    expect(!result.ok && result.error.kind === "repository" && result.error.error.code).toBe("version_conflict");
    expect(repo.saves).toBe(3);
  });

  it("reports a missing plan and does not retry other failures", async () => {
    const missing = await applyPlanEvent(new MemoryRepository(null), "plan-1", agree("ana"));
    expect(!missing.ok && missing.error.kind === "repository" && missing.error.error.code).toBe("not_found");

    const down = new MemoryRepository(storedAt(reviewing()), undefined, { code: "unavailable", message: "db down" });
    const result = await applyPlanEvent(down, "plan-1", agree("ana"));
    expect(!result.ok && result.error.kind === "repository" && result.error.error.code).toBe("unavailable");
    expect(down.saves).toBe(1);
  });
});

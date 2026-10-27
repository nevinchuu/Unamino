import { err, ok, type Result } from "@/lib/result";
import type { MemberSnapshot } from "@/domain/plan/types";
import type { MemoryPlanRepository } from "@/domain/plan/test-support";
import type { HoldRecord, HoldStore, HoldStoreError } from "./hold-store";

/** Remembers holds in memory, reading everything else about the member from the in-memory plan, like the real store reads it from the database. */
export class MemoryHoldStore implements HoldStore {
  private readonly ids = new Map<string, string>();
  private readonly attempts = new Map<string, number>();
  /** Makes every call fail as if the database could not be reached. */
  down = false;

  constructor(
    private readonly plans: MemoryPlanRepository,
    private readonly currencies: Readonly<Record<string, string>> = {},
  ) {}

  private key = (planId: string, memberId: string): string => `${planId}/${memberId}`;
  private unavailable = (): Result<never, HoldStoreError> => err({ code: "unavailable", message: "The database could not be reached" });
  private member(memberId: string): MemberSnapshot | undefined {
    return this.plans.plan.members.find((candidate) => candidate.id === memberId);
  }

  async find(planId: string, memberId: string): Promise<Result<HoldRecord, HoldStoreError>> {
    if (this.down) return this.unavailable();
    const member = planId === this.plans.stored.id ? this.member(memberId) : undefined;
    if (!member) return err({ code: "not_found", message: "That person is not in that plan" });
    const key = this.key(planId, memberId);
    return ok({
      planId,
      memberId,
      currency: this.currencies[memberId] ?? "USD",
      planStatus: this.plans.plan.status,
      approval: member.approval,
      approvedMinor: member.approvedMinor,
      holdPlaced: member.holdPlaced,
      holdId: this.ids.get(key) ?? null,
      holdAttempt: this.attempts.get(key) ?? 0,
    });
  }

  async findByHoldId(holdId: string): Promise<Result<{ planId: string; memberId: string }, HoldStoreError>> {
    if (this.down) return this.unavailable();
    for (const [key, id] of this.ids) {
      if (id === holdId) {
        const [planId, memberId] = key.split("/");
        return ok({ planId, memberId });
      }
    }
    return err({ code: "not_found", message: "No member has that hold" });
  }

  async saveHoldId(planId: string, memberId: string, attempt: number, holdId: string): Promise<Result<string, HoldStoreError>> {
    if (this.down) return this.unavailable();
    const key = this.key(planId, memberId);
    if ((this.attempts.get(key) ?? 0) !== attempt) return err({ code: "stale", message: "The member has moved on to another hold" });
    const existing = this.ids.get(key);
    if (existing) return ok(existing);
    this.ids.set(key, holdId);
    return ok(holdId);
  }

  async clearHold(planId: string, memberId: string, holdId: string): Promise<Result<void, HoldStoreError>> {
    if (this.down) return this.unavailable();
    const key = this.key(planId, memberId);
    if (this.ids.get(key) === holdId) {
      this.ids.delete(key);
      this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
    }
    return ok(undefined);
  }

  /** For tests: the hold saved for a member. */
  holdIdOf(planId: string, memberId: string): string | null {
    return this.ids.get(this.key(planId, memberId)) ?? null;
  }
}

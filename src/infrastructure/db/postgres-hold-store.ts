import { and, eq, isNull, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { HoldRecord, HoldStore, HoldStoreError } from "@/domain/payments/hold-store";
import type { Database } from "./client";
import { members, planMembers, plans } from "./schema";

const failure = (code: HoldStoreError["code"], message: string): Result<never, HoldStoreError> => err({ code, message });
const unavailable = (): Result<never, HoldStoreError> => failure("unavailable", "The database could not be reached");

/** Remembers which payment-provider hold belongs to which member of which plan. */
export class PostgresHoldStore implements HoldStore {
  constructor(private readonly db: Database) {}

  async find(planId: string, memberId: string): Promise<Result<HoldRecord, HoldStoreError>> {
    try {
      const [row] = await this.db
        .select({ plan: plans.status, member: planMembers, currency: members.currency })
        .from(planMembers)
        .innerJoin(plans, eq(plans.id, planMembers.planId))
        .innerJoin(members, eq(members.id, planMembers.memberId))
        .where(and(eq(planMembers.planId, planId), eq(planMembers.memberId, memberId)))
        .limit(1);
      if (!row) return failure("not_found", "That person is not in that plan");
      return ok({
        planId,
        memberId,
        currency: row.currency,
        planStatus: row.plan,
        approval: row.member.approval,
        approvedMinor: row.member.approvedMinor,
        holdPlaced: row.member.holdPlaced,
        holdId: row.member.holdId,
        holdAttempt: row.member.holdAttempt,
      });
    } catch {
      return unavailable();
    }
  }

  async findByHoldId(holdId: string): Promise<Result<{ planId: string; memberId: string }, HoldStoreError>> {
    try {
      const [row] = await this.db.select({ planId: planMembers.planId, memberId: planMembers.memberId }).from(planMembers).where(eq(planMembers.holdId, holdId)).limit(1);
      return row ? ok(row) : failure("not_found", "No member has that hold");
    } catch {
      return unavailable();
    }
  }

  async saveHoldId(planId: string, memberId: string, attempt: number, holdId: string): Promise<Result<string, HoldStoreError>> {
    try {
      const mine = and(eq(planMembers.planId, planId), eq(planMembers.memberId, memberId), eq(planMembers.holdAttempt, attempt));
      // Only the first call for an attempt writes; a second one at the same moment finds the id already there.
      const saved = await this.db.update(planMembers).set({ holdId }).where(and(mine, isNull(planMembers.holdId))).returning({ holdId: planMembers.holdId });
      if (saved.length > 0) return ok(holdId);

      const [current] = await this.db.select({ holdId: planMembers.holdId, attempt: planMembers.holdAttempt }).from(planMembers).where(and(eq(planMembers.planId, planId), eq(planMembers.memberId, memberId))).limit(1);
      if (!current) return failure("not_found", "That person is not in that plan");
      if (current.attempt !== attempt || current.holdId === null) return failure("stale", "The member has moved on to another hold");
      return ok(current.holdId);
    } catch {
      return unavailable();
    }
  }

  async clearHold(planId: string, memberId: string, holdId: string): Promise<Result<void, HoldStoreError>> {
    try {
      await this.db
        .update(planMembers)
        .set({ holdId: null, holdAttempt: sql`${planMembers.holdAttempt} + 1` })
        .where(and(eq(planMembers.planId, planId), eq(planMembers.memberId, memberId), eq(planMembers.holdId, holdId)));
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }
}

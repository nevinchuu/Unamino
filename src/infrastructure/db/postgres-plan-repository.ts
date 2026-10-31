import { and, asc, eq, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { PlanRepository, RepositoryError, StoredPlan } from "@/domain/plan/repository";
import type { MemberSnapshot, PlanSnapshot } from "@/domain/plan/types";
import type { Database } from "./client";
import { members, planMembers, plans } from "./schema";

type PlanRow = typeof plans.$inferSelect;
type PlanMemberRow = typeof planMembers.$inferSelect;

const failure = (code: RepositoryError["code"], message: string): Result<never, RepositoryError> => err({ code, message });

/** Thrown inside a transaction to roll it back and carry a typed reason out. */
class Rollback extends Error {
  constructor(readonly reason: RepositoryError) {
    super(reason.message);
  }
}

const toMemberSnapshot = (row: PlanMemberRow): MemberSnapshot => ({
  id: row.memberId,
  planAgreement: row.planAgreement,
  agreedShareMinor: row.agreedShareMinor,
  approval: row.approval,
  approvedMinor: row.approvedMinor,
  currentShareMinor: row.currentShareMinor,
  chargedMinor: row.chargedMinor,
  approvalExpiresAt: row.approvalExpiresAt,
  holdPlaced: row.holdPlaced,
});

const toPlanSnapshot = (plan: PlanRow, memberRows: readonly PlanMemberRow[]): PlanSnapshot => ({
  status: plan.status,
  deadlineAt: plan.deadlineAt,
  hardDeadlineAt: plan.hardDeadlineAt,
  members: memberRows.map(toMemberSnapshot),
});

/**
 * Stores plans in Postgres. A save is `UPDATE ... WHERE id = $1 AND version = $2`: if someone else saved first
 * it changes nothing and reports a conflict, so two people acting at once can never overwrite each other.
 * The plan row and every member row are saved in one transaction, so a plan is never half-saved.
 */
export class PostgresPlanRepository implements PlanRepository {
  constructor(private readonly db: Database) {}

  async load(planId: string): Promise<Result<StoredPlan, RepositoryError>> {
    try {
      const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) return failure("not_found", "There is no such plan");

      // Joined in the order they were added, so the order of effects and receipts is the same every time.
      const rows = await this.db
        .select({ row: planMembers })
        .from(planMembers)
        .innerJoin(members, eq(members.id, planMembers.memberId))
        .where(eq(planMembers.planId, planId))
        .orderBy(asc(members.createdAt), asc(members.id));

      return ok({ id: plan.id, version: plan.version, plan: toPlanSnapshot(plan, rows.map(({ row }) => row)) });
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async save(stored: StoredPlan, next: PlanSnapshot): Promise<Result<StoredPlan, RepositoryError>> {
    try {
      const version = await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(plans)
          // updatedAt is when the status last changed, which is what the booking sweeps measure "stuck" from. A save that only
          // re-checks prices or extends the deadline, as every look at a live plan does, must not make a stalled plan look fresh.
          .set({ status: next.status, deadlineAt: next.deadlineAt, version: sql`${plans.version} + 1`, updatedAt: next.status === stored.plan.status ? sql`${plans.updatedAt}` : new Date() })
          .where(and(eq(plans.id, stored.id), eq(plans.version, stored.version)))
          .returning({ version: plans.version });

        if (updated.length === 0) {
          const [exists] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, stored.id)).limit(1);
          throw new Rollback(
            exists
              ? { code: "version_conflict", message: "The plan was changed by someone else" }
              : { code: "not_found", message: "There is no such plan" },
          );
        }

        for (const member of next.members) {
          const changed = await tx
            .update(planMembers)
            .set({
              planAgreement: member.planAgreement,
              agreedShareMinor: member.agreedShareMinor,
              approval: member.approval,
              approvedMinor: member.approvedMinor,
              currentShareMinor: member.currentShareMinor,
              chargedMinor: member.chargedMinor,
              approvalExpiresAt: member.approvalExpiresAt,
              holdPlaced: member.holdPlaced,
            })
            .where(and(eq(planMembers.planId, stored.id), eq(planMembers.memberId, member.id)))
            .returning({ memberId: planMembers.memberId });
          if (changed.length === 0) throw new Rollback({ code: "member_mismatch", message: `${member.id} is not in this plan` });
        }

        // A snapshot that leaves someone out would silently keep their old state, so the counts must agree.
        const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(planMembers).where(eq(planMembers.planId, stored.id));
        if (total !== next.members.length) throw new Rollback({ code: "member_mismatch", message: "The snapshot does not list everyone in the plan" });

        return updated[0].version;
      });
      return ok({ id: stored.id, version, plan: next });
    } catch (error) {
      if (error instanceof Rollback) return err(error.reason);
      return failure("unavailable", "The database could not be reached");
    }
  }
}

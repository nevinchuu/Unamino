import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery } from "@/domain/offers/offer-source";
import type { PlanDetails, PlanDetailsStore, RenewedPick } from "@/domain/plan/details-store";
import type { RepositoryError } from "@/domain/plan/repository";
import { EXPIRABLE_PLAN_STATUSES } from "@/domain/plan/statuses";
import type { Database } from "./client";
import { readCovers } from "./postgres-cover-store";
import { members, offerSearches, planMembers, planPicks, plans } from "./schema";

const unavailable = (): Result<never, RepositoryError> => err({ code: "unavailable", message: "The database could not be reached" });

/** Thrown inside a transaction to roll it back when a pick does not belong to the plan. */
class NotThisPlan extends Error {}

/** The parts of a plan that pricing it again needs. Approval state is not here: `PostgresPlanRepository` owns it. */
export class PostgresPlanDetailsStore implements PlanDetailsStore {
  constructor(private readonly db: Database) {}

  async load(planId: string): Promise<Result<PlanDetails, RepositoryError>> {
    try {
      const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) return err({ code: "not_found", message: "There is no such plan" });

      // The same order the plan repository uses, so shares line up with the snapshot's members.
      const memberRows = await this.db
        .select({ id: members.id, currency: members.currency })
        .from(planMembers)
        .innerJoin(members, eq(members.id, planMembers.memberId))
        .where(eq(planMembers.planId, planId))
        .orderBy(asc(members.createdAt), asc(members.id));

      const pickRows = await this.db.select().from(planPicks).where(eq(planPicks.planId, planId)).orderBy(asc(planPicks.position));

      const searchIds = [...new Set(pickRows.flatMap((pick) => (pick.searchId ? [pick.searchId] : [])))];
      const searchRows = searchIds.length === 0 ? [] : await this.db.select({ id: offerSearches.id, query: offerSearches.query }).from(offerSearches).where(inArray(offerSearches.id, searchIds));
      const queries = new Map<string, OfferQuery>(searchRows.map((row) => [row.id, row.query]));

      return ok({
        planId: plan.id,
        baseCurrency: plan.baseCurrency,
        fx: plan.fx,
        offersCheckedAt: plan.offersCheckedAt,
        covers: await readCovers(this.db, planId),
        members: memberRows,
        picks: pickRows.map((pick) => ({ id: pick.id, offer: pick.offer, searchId: pick.searchId, memberIds: pick.memberIds })),
        queries,
      });
    } catch {
      return unavailable();
    }
  }

  async claimRefresh(planId: string, now: Date, cooldownMs: number): Promise<Result<boolean, RepositoryError>> {
    try {
      const earliestNext = new Date(now.getTime() - cooldownMs);
      // One statement, so of several callers at once exactly one sees the row still outside the cooldown.
      const claimed = await this.db
        .update(plans)
        .set({ offersCheckedAt: now })
        .where(and(eq(plans.id, planId), or(isNull(plans.offersCheckedAt), lte(plans.offersCheckedAt, earliestNext))))
        .returning({ id: plans.id });
      if (claimed.length > 0) return ok(true);

      const [exists] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId)).limit(1);
      return exists ? ok(false) : err({ code: "not_found", message: "There is no such plan" });
    } catch {
      return unavailable();
    }
  }

  async saveRenewal(planId: string, renewed: readonly RenewedPick[]): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.transaction(async (tx) => {
        for (const { pickId, offer } of renewed) {
          const changed = await tx
            .update(planPicks)
            .set({ offer })
            .where(and(eq(planPicks.id, pickId), eq(planPicks.planId, planId)))
            .returning({ id: planPicks.id });
          // A renewal for a pick of another plan would silently rewrite someone else's offer.
          if (changed.length === 0) throw new NotThisPlan();
        }
      });
      return ok(undefined);
    } catch (error) {
      if (error instanceof NotThisPlan) return err({ code: "not_found", message: "A pick does not belong to this plan" });
      return unavailable();
    }
  }

  async listPastDeadline(now: Date, limit: number): Promise<Result<readonly string[], RepositoryError>> {
    try {
      const rows = await this.db
        .select({ id: plans.id })
        .from(plans)
        .where(and(inArray(plans.status, [...EXPIRABLE_PLAN_STATUSES]), lte(plans.deadlineAt, now)))
        .orderBy(asc(plans.deadlineAt), asc(plans.id))
        .limit(limit);
      return ok(rows.map((row) => row.id));
    } catch {
      return unavailable();
    }
  }
}

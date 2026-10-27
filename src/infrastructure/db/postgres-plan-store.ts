import { asc, count, desc, and, eq, inArray } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { CommittedTrip, NewPlan, PlanCardSummary, PlanStore, PlanSummary, StoreError } from "@/domain/agent/ports";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { Database } from "./client";
import { isUniqueViolation } from "./errors";
import { planMembers, planPicks, plans, scheduleSuggestions, tripBriefs } from "./schema";

const REPLACED_ONCE = "plans_replaced_once";
/** Trips whose dates are taken: money is being collected for them or has been. */
const COMMITTED_STATUSES: PlanStatus[] = ["booking", "booked", "captured"];

/** Creates plans for the agent. Everything a new plan needs is saved together, so it is never half there. */
export class PostgresPlanStore implements PlanStore {
  constructor(private readonly db: Database) {}

  async latest(groupId: string): Promise<PlanSummary | null> {
    const [plan] = await this.db.select().from(plans).where(eq(plans.groupId, groupId)).orderBy(desc(plans.createdAt), desc(plans.id)).limit(1);
    if (!plan) return null;
    const [{ agreed }] = await this.db.select({ agreed: count() }).from(planMembers).where(and(eq(planMembers.planId, plan.id), eq(planMembers.planAgreement, "agreed")));
    return { id: plan.id, title: plan.title, status: plan.status, inputsHash: plan.inputsHash, headcount: plan.headcount, agreedCount: agreed };
  }

  async cards(groupId: string): Promise<readonly PlanCardSummary[]> {
    const rows = await this.db.select().from(plans).where(eq(plans.groupId, groupId)).orderBy(asc(plans.createdAt), asc(plans.id));
    if (rows.length === 0) return [];
    const agreed = await this.db
      .select({ planId: planMembers.planId, agreed: count() })
      .from(planMembers)
      .where(and(inArray(planMembers.planId, rows.map((row) => row.id)), eq(planMembers.planAgreement, "agreed")))
      .groupBy(planMembers.planId);
    const agreedBy = new Map(agreed.map((row) => [row.planId, row.agreed]));
    return rows.map((row) => ({ id: row.id, title: row.title, status: row.status, headcount: row.headcount, agreedCount: agreedBy.get(row.id) ?? 0, replacedById: row.replacedByPlanId }));
  }

  async committedTrips(groupId: string): Promise<readonly CommittedTrip[]> {
    const rows = await this.db
      .select({ planId: plans.id, title: plans.title, departDate: tripBriefs.departDate, returnDate: tripBriefs.returnDate })
      .from(plans)
      .innerJoin(tripBriefs, eq(tripBriefs.id, plans.briefId))
      .where(and(eq(plans.groupId, groupId), inArray(plans.status, COMMITTED_STATUSES)));
    return rows.flatMap((row) => (row.departDate && row.returnDate ? [{ planId: row.planId, title: row.title, departDate: row.departDate, returnDate: row.returnDate }] : []));
  }

  async create(plan: NewPlan): Promise<Result<string, StoreError>> {
    try {
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(plans)
          .values({
            groupId: plan.groupId,
            briefId: plan.briefId,
            title: plan.title,
            summary: plan.summary,
            deadlineAt: plan.deadlineAt,
            hardDeadlineAt: plan.hardDeadlineAt,
            baseCurrency: plan.baseCurrency,
            fx: plan.fx,
            headcount: plan.headcount,
            inputsHash: plan.inputsHash,
            offersCheckedAt: plan.offersCheckedAt,
            recreatedFromPlanId: plan.recreatedFromPlanId,
          })
          .returning({ id: plans.id });

        await tx.insert(planMembers).values(plan.memberIds.map((memberId) => ({ planId: row.id, memberId })));
        if (plan.picks.length > 0) {
          await tx.insert(planPicks).values(
            plan.picks.map((pick, position) => ({ planId: row.id, position, offer: pick.offer, listingId: pick.offer.listingId, searchId: pick.searchId, memberIds: [...pick.memberIds], reason: pick.reason, notes: { ...pick.notes } })),
          );
        }
        if (plan.suggestions.length > 0) {
          await tx.insert(scheduleSuggestions).values(
            plan.suggestions.map((s) => ({ planId: row.id, gapId: s.gapId, date: s.date, startTime: s.startTime, endTime: s.endTime, category: s.category, why: s.why, venue: s.venue, checkedAt: new Date(s.checkedAt) })),
          );
        }
        return row.id;
      });
      return ok(id);
    } catch (error) {
      // Someone else already replaced the plan this one was meant to replace.
      if (isUniqueViolation(error, REPLACED_ONCE)) return err({ code: "conflict", message: "That plan has already been replaced" });
      return err({ code: "unavailable", message: "The plan could not be saved" });
    }
  }

  async remove(planId: string): Promise<void> {
    await this.db.delete(plans).where(eq(plans.id, planId));
  }

  async markReplaced(oldPlanId: string, newPlanId: string): Promise<void> {
    await this.db.update(plans).set({ replacedByPlanId: newPlanId }).where(eq(plans.id, oldPlanId));
  }
}

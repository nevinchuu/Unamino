import { count, desc, and, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { NewPlan, PlanStore, PlanSummary, StoreError } from "@/domain/agent/ports";
import type { Database } from "./client";
import { isUniqueViolation } from "./errors";
import { planMembers, planPicks, plans, scheduleSuggestions } from "./schema";

const REPLACED_ONCE = "plans_replaced_once";

/** Creates plans for the agent. Everything a new plan needs is saved together, so it is never half there. */
export class PostgresPlanStore implements PlanStore {
  constructor(private readonly db: Database) {}

  async latest(groupId: string): Promise<PlanSummary | null> {
    const [plan] = await this.db.select().from(plans).where(eq(plans.groupId, groupId)).orderBy(desc(plans.createdAt), desc(plans.id)).limit(1);
    if (!plan) return null;
    const [{ agreed }] = await this.db.select({ agreed: count() }).from(planMembers).where(and(eq(planMembers.planId, plan.id), eq(planMembers.planAgreement, "agreed")));
    return { id: plan.id, status: plan.status, inputsHash: plan.inputsHash, headcount: plan.headcount, agreedCount: agreed };
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

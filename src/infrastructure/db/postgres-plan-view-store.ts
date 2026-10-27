import { asc, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { RepositoryError } from "@/domain/plan/repository";
import type { PlanViewRaw, PlanViewStore } from "@/domain/plan/view-store";
import type { Database } from "./client";
import { members, planMembers, planPicks, plans, scheduleSuggestions, tripBriefs } from "./schema";

const unavailable = (): Result<never, RepositoryError> => err({ code: "unavailable", message: "The database could not be reached" });

/** Reads a plan with everything the plan screen shows, in one place, with people's names. */
export class PostgresPlanViewStore implements PlanViewStore {
  constructor(private readonly db: Database) {}

  async load(planId: string): Promise<Result<PlanViewRaw, RepositoryError>> {
    try {
      const [found] = await this.db.select({ plan: plans, brief: tripBriefs }).from(plans).innerJoin(tripBriefs, eq(tripBriefs.id, plans.briefId)).where(eq(plans.id, planId)).limit(1);
      if (!found) return err({ code: "not_found", message: "There is no such plan" });
      const { plan, brief } = found;

      // The same order the plan repository and the pricing use, so people always appear in the same order.
      const people = await this.db
        .select({ row: planMembers, name: members.displayName, currency: members.currency })
        .from(planMembers)
        .innerJoin(members, eq(members.id, planMembers.memberId))
        .where(eq(planMembers.planId, planId))
        .orderBy(asc(members.createdAt), asc(members.id));

      const picks = await this.db.select().from(planPicks).where(eq(planPicks.planId, planId)).orderBy(asc(planPicks.position));
      const ideas = await this.db.select().from(scheduleSuggestions).where(eq(scheduleSuggestions.planId, planId)).orderBy(asc(scheduleSuggestions.date), asc(scheduleSuggestions.startTime));

      return ok({
        id: plan.id,
        groupId: plan.groupId,
        title: plan.title,
        summary: plan.summary,
        status: plan.status,
        deadlineAt: plan.deadlineAt,
        baseCurrency: plan.baseCurrency,
        fx: plan.fx,
        headcount: plan.headcount,
        replacedByPlanId: plan.replacedByPlanId,
        trip: { city: brief.destinationCity, departDate: brief.departDate, returnDate: brief.returnDate },
        members: people.map(({ row, name, currency }) => ({ id: row.memberId, name, currency, planAgreement: row.planAgreement, approval: row.approval, approvedMinor: row.approvedMinor, holdPlaced: row.holdPlaced })),
        picks: picks.map((pick) => ({ id: pick.id, offer: pick.offer, memberIds: pick.memberIds, reason: pick.reason, notes: pick.notes })),
        ideas: ideas.map((idea) => ({ id: idea.id, date: idea.date, startTime: idea.startTime, endTime: idea.endTime, category: idea.category, why: idea.why, venue: idea.venue })),
      });
    } catch {
      return unavailable();
    }
  }

  async groupIdOf(planId: string): Promise<Result<string | null, RepositoryError>> {
    try {
      const [row] = await this.db.select({ groupId: plans.groupId }).from(plans).where(eq(plans.id, planId)).limit(1);
      return ok(row?.groupId ?? null);
    } catch {
      return unavailable();
    }
  }
}

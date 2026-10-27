import { and, count, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { RepositoryError } from "@/domain/plan/repository";
import type { PlanPublicStatus, PlanStatusReader } from "@/domain/plan/status-reader";
import type { Database } from "./client";
import { planMembers, plans } from "./schema";

/** Reads only what the public status endpoint may show: a state and counts. No member, name or amount is selected. */
export class PostgresPlanStatusReader implements PlanStatusReader {
  constructor(private readonly db: Database) {}

  async read(planId: string): Promise<Result<PlanPublicStatus, RepositoryError>> {
    try {
      const [plan] = await this.db.select({ status: plans.status, deadlineAt: plans.deadlineAt }).from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) return err({ code: "not_found", message: "There is no such plan" });

      const countWhere = async (extra?: ReturnType<typeof eq>): Promise<number> => {
        const [row] = await this.db.select({ total: count() }).from(planMembers).where(extra ? and(eq(planMembers.planId, planId), extra) : eq(planMembers.planId, planId));
        return row.total;
      };
      const [memberCount, agreedCount, approvedCount] = await Promise.all([
        countWhere(),
        countWhere(eq(planMembers.planAgreement, "agreed")),
        countWhere(eq(planMembers.approval, "approved")),
      ]);
      return ok({ status: plan.status, memberCount, agreedCount, approvedCount, deadlineAt: plan.deadlineAt });
    } catch {
      return err({ code: "unavailable", message: "The database could not be reached" });
    }
  }
}

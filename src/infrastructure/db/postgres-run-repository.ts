import { and, count, eq, gt, gte, lt } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { AgentRunRepository, RecentRuns, RunOutcome, StartedRun, StoreError } from "@/domain/agent/ports";
import type { Database } from "./client";
import { isUniqueViolation } from "./errors";
import { agentRuns } from "./schema";

const ONE_RUNNING_PER_GROUP = "agent_runs_one_running_per_group";

const unavailable = (): Result<never, StoreError> => err({ code: "unavailable", message: "The database could not be reached" });

/**
 * Records each call to the agent. The database allows only one running call per group and one run per message, so
 * two people mentioning the agent at the same moment cannot both start work.
 */
export class PostgresRunRepository implements AgentRunRepository {
  constructor(private readonly db: Database) {}

  async start(input: { groupId: string; triggerMessageId: string; requestedByMemberId: string | null; now: Date; staleAfterMs: number }): Promise<Result<StartedRun, StoreError>> {
    try {
      const run = await this.db.transaction(async (tx) => {
        // A run that never finished (the server stopped mid-way) would block the group for good, so it is written off.
        await tx
          .update(agentRuns)
          .set({ status: "failed", errorCode: "timed_out", finishedAt: input.now })
          .where(and(eq(agentRuns.groupId, input.groupId), eq(agentRuns.status, "running"), lt(agentRuns.startedAt, new Date(input.now.getTime() - input.staleAfterMs))));
        const [row] = await tx
          .insert(agentRuns)
          .values({ groupId: input.groupId, triggerMessageId: input.triggerMessageId, requestedByMemberId: input.requestedByMemberId, startedAt: input.now })
          .returning({ id: agentRuns.id });
        return row;
      });
      return ok({ status: "started", run: { id: run.id, groupId: input.groupId, triggerMessageId: input.triggerMessageId } });
    } catch (error) {
      if (isUniqueViolation(error, ONE_RUNNING_PER_GROUP)) return ok({ status: "busy" });
      // The only other unique rule on a run is one per trigger message.
      if (isUniqueViolation(error)) return ok({ status: "duplicate" });
      return unavailable();
    }
  }

  async countRecent(groupId: string, memberId: string | null, since: Date): Promise<Result<RecentRuns, StoreError>> {
    try {
      const inGroup = and(eq(agentRuns.groupId, groupId), gte(agentRuns.startedAt, since));
      const [group] = await this.db.select({ total: count() }).from(agentRuns).where(inGroup);
      if (memberId === null) return ok({ group: group.total, member: 0 });
      const [member] = await this.db.select({ total: count() }).from(agentRuns).where(and(inGroup, eq(agentRuns.requestedByMemberId, memberId)));
      return ok({ group: group.total, member: member.total });
    } catch {
      return unavailable();
    }
  }

  async countAll(since: Date): Promise<Result<number, StoreError>> {
    try {
      const [all] = await this.db.select({ total: count() }).from(agentRuns).where(gte(agentRuns.startedAt, since));
      return ok(all.total);
    } catch {
      return unavailable();
    }
  }

  async isRunning(groupId: string, now: Date, staleAfterMs: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.groupId, groupId), eq(agentRuns.status, "running"), gt(agentRuns.startedAt, new Date(now.getTime() - staleAfterMs))))
      .limit(1);
    return row !== undefined;
  }

  async finish(runId: string, outcome: RunOutcome, now: Date): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({
        status: outcome.status,
        model: outcome.model ?? null,
        promptTokens: outcome.usage.promptTokens,
        completionTokens: outcome.usage.completionTokens,
        reasoningTokens: outcome.usage.reasoningTokens,
        errorCode: outcome.errorCode ?? null,
        finishedAt: now,
      })
      .where(eq(agentRuns.id, runId));
  }
}

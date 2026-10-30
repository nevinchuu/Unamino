import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { GroupAdminStore } from "@/domain/group/admin-store";
import type { GroupError } from "@/domain/group/types";
import type { Database } from "./client";
import { groups, members, plans } from "./schema";

const failure = (code: GroupError["code"], message: string): Result<never, GroupError> => err({ code, message });

/** Thrown inside a transaction to roll it back and carry a typed reason out. */
class Rollback extends Error {
  constructor(readonly reason: GroupError) {
    super(reason.message);
  }
}

export class PostgresGroupAdminStore implements GroupAdminStore {
  constructor(private readonly db: Database) {}

  async planStatuses(groupId: string): ReturnType<GroupAdminStore["planStatuses"]> {
    try {
      const rows = await this.db.select({ id: plans.id, status: plans.status }).from(plans).where(eq(plans.groupId, groupId));
      return ok(rows);
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async transferOrganiser(groupId: string, fromMemberId: string, toMemberId: string): Promise<Result<void, GroupError>> {
    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx.select().from(members).where(and(eq(members.groupId, groupId), eq(members.status, "joined"))).for("update");
        const from = rows.find((row) => row.id === fromMemberId);
        const to = rows.find((row) => row.id === toMemberId);
        if (!from?.isOrganiser) throw new Rollback({ code: "forbidden", message: "Only the group admin can hand over the role" });
        if (!to) throw new Rollback({ code: "not_found", message: "That person is not in the group" });
        // There is only ever one admin, so the old one steps down first.
        await tx.update(members).set({ isOrganiser: false }).where(eq(members.id, fromMemberId));
        await tx.update(members).set({ isOrganiser: true }).where(eq(members.id, toMemberId));
        return ok(undefined);
      });
    } catch (error) {
      if (error instanceof Rollback) return err(error.reason);
      return failure("unavailable", "The database could not be reached");
    }
  }

  async deleteGroup(groupId: string): Promise<Result<void, GroupError>> {
    try {
      await this.db.transaction(async (tx) => {
        // Plans first: they point at the group's briefs and members, which the group's own removal would take away.
        await tx.delete(plans).where(eq(plans.groupId, groupId));
        await tx.delete(groups).where(eq(groups.id, groupId));
      });
      return ok(undefined);
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }
}

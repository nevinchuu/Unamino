import { inArray, sql } from "drizzle-orm";
import type { ConstraintSet } from "@/domain/constraints/schema";
import type { ConstraintRepository } from "@/domain/agent/ports";
import type { Database } from "./client";
import { memberConstraints } from "./schema";

/** What each member has asked for. Saving replaces only the people it names, so someone who said nothing new keeps what they said. */
export class PostgresConstraintRepository implements ConstraintRepository {
  constructor(private readonly db: Database) {}

  async forMembers(memberIds: readonly string[]): Promise<ConstraintSet> {
    if (memberIds.length === 0) return {};
    const rows = await this.db.select().from(memberConstraints).where(inArray(memberConstraints.memberId, [...memberIds]));
    return Object.fromEntries(rows.map((row) => [row.memberId, row.constraints]));
  }

  async save(constraints: ConstraintSet): Promise<void> {
    const entries = Object.entries(constraints);
    if (entries.length === 0) return;
    await this.db
      .insert(memberConstraints)
      .values(entries.map(([memberId, value]) => ({ memberId, constraints: value })))
      .onConflictDoUpdate({ target: memberConstraints.memberId, set: { constraints: sql`excluded.constraints`, updatedAt: new Date() } });
  }
}

import { and, eq, inArray, lt } from "drizzle-orm";
import type { ReadMarkers } from "@/domain/group/read-markers";
import type { Database } from "./client";
import { members } from "./schema";

/** Keeps each person's read marker on their row in `members`. */
export class PostgresReadMarkers implements ReadMarkers {
  constructor(private readonly db: Database) {}

  async lastRead(memberIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (memberIds.length === 0) return new Map();
    const rows = await this.db.select({ id: members.id, seq: members.lastReadSeq }).from(members).where(inArray(members.id, [...memberIds]));
    return new Map(rows.map((row) => [row.id, row.seq]));
  }

  async markRead(memberId: string, seq: number): Promise<void> {
    // The condition in the update is what stops the marker moving back, even when two polls race.
    await this.db.update(members).set({ lastReadSeq: seq }).where(and(eq(members.id, memberId), lt(members.lastReadSeq, seq)));
  }
}

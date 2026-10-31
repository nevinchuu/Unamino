import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { AgentBookingFailure, BookingFailureReader } from "@/domain/agent/ports";
import type { BookingFailureRecord } from "@/domain/booking/failure";
import type { BookingFailureStore, BookingStoreError } from "@/domain/booking/ports";
import type { Database } from "./client";
import { bookingFailures, plans } from "./schema";

/** Keeps why a booking failed, and tells Trippy about it. Both are read-mostly and small: one row per failed plan. */
export class PostgresBookingFailureStore implements BookingFailureStore, BookingFailureReader {
  constructor(private readonly db: Database) {}

  async save(record: BookingFailureRecord): Promise<Result<void, BookingStoreError>> {
    try {
      await this.db
        .insert(bookingFailures)
        .values({
          planId: record.planId,
          reason: record.reason,
          cause: record.cause ?? null,
          partKind: record.part?.kind ?? null,
          partTitle: record.part?.title ?? null,
          listingId: record.part?.listingId ?? null,
          offeredMinor: record.part?.offeredMinor ?? null,
          currency: record.part?.currency ?? null,
          retryable: record.retryable,
          undone: record.undone,
        })
        // A plan fails once. If it is said again, the first reason stands.
        .onConflictDoNothing();
      return ok(undefined);
    } catch {
      return err({ message: "The booking failure could not be saved" });
    }
  }

  async latest(groupId: string): Promise<AgentBookingFailure | null> {
    try {
      const [newest] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.groupId, groupId)).orderBy(desc(plans.createdAt)).limit(1);
      if (!newest) return null;
      const [row] = await this.db.select().from(bookingFailures).where(eq(bookingFailures.planId, newest.id)).limit(1);
      if (!row) return null;
      return {
        reason: row.reason,
        part: row.partKind && row.partTitle ? { kind: row.partKind, title: row.partTitle } : null,
        undone: row.undone,
        retryable: row.retryable,
      };
    } catch {
      // Trippy plans without it rather than not at all.
      return null;
    }
  }

  async blockedListingIds(groupId: string, since: Date): Promise<ReadonlySet<string>> {
    try {
      const rows = await this.db
        .select({ listingId: bookingFailures.listingId })
        .from(bookingFailures)
        .innerJoin(plans, eq(plans.id, bookingFailures.planId))
        .where(and(eq(plans.groupId, groupId), gte(bookingFailures.createdAt, since), eq(bookingFailures.retryable, false), isNotNull(bookingFailures.listingId)));
      return new Set(rows.flatMap((row) => (row.listingId ? [row.listingId] : [])));
    } catch {
      return new Set();
    }
  }
}

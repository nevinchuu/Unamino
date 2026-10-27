import { desc, eq, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { BriefRepository, StoredBrief, StoreError } from "@/domain/agent/ports";
import type { TripFields } from "@/domain/trip/brief-schema";
import type { Database } from "./client";
import { isUniqueViolation } from "./errors";
import { tripBriefs } from "./schema";

type BriefRow = typeof tripBriefs.$inferSelect;

const MAX_ATTEMPTS = 3;

const toStored = (row: BriefRow): StoredBrief => ({
  id: row.id,
  version: row.version,
  headcount: row.headcount,
  fields: {
    destinationCity: row.destinationCity ?? undefined,
    destinationCountry: row.destinationCountry ?? undefined,
    destinationAirport: row.destinationAirport ?? undefined,
    originAirport: row.originAirport ?? undefined,
    departDate: row.departDate ?? undefined,
    returnDate: row.returnDate ?? undefined,
  },
});

/** Keeps each version of what the group has said about where and when. A new row is written for every change. */
export class PostgresBriefRepository implements BriefRepository {
  constructor(private readonly db: Database) {}

  async latest(groupId: string): Promise<StoredBrief | null> {
    const [row] = await this.db.select().from(tripBriefs).where(eq(tripBriefs.groupId, groupId)).orderBy(desc(tripBriefs.version)).limit(1);
    return row ? toStored(row) : null;
  }

  async save(input: { groupId: string; fields: TripFields; headcount: number; openQuestions: readonly string[]; runId: string }): Promise<Result<StoredBrief, StoreError>> {
    const { fields } = input;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const [row] = await this.db
          .insert(tripBriefs)
          .values({
            groupId: input.groupId,
            // Worked out by the database in the same statement, so two writers cannot both pick the same number.
            version: sql`(select coalesce(max(${tripBriefs.version}), 0) + 1 from ${tripBriefs} where ${tripBriefs.groupId} = ${input.groupId})`,
            destinationCity: fields.destinationCity ?? null,
            destinationCountry: fields.destinationCountry ?? null,
            destinationAirport: fields.destinationAirport ?? null,
            originAirport: fields.originAirport ?? null,
            departDate: fields.departDate ?? null,
            returnDate: fields.returnDate ?? null,
            headcount: input.headcount,
            openQuestions: [...input.openQuestions],
            createdByRunId: input.runId,
          })
          .returning();
        return ok(toStored(row));
      } catch (error) {
        // Another writer took that version number between the read and the write: try again with the next one.
        if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) continue;
        return err({ code: isUniqueViolation(error) ? "conflict" : "unavailable", message: "The brief could not be saved" });
      }
    }
    return err({ code: "conflict", message: "The brief could not be saved" });
  }
}

import { eq, inArray, lt } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { TravellerStore, TravellerStoreError } from "@/domain/travellers/ports";
import type { Database } from "./client";
import { travellerDetails } from "./schema";

const unavailable = (): Result<never, TravellerStoreError> => err({ code: "unavailable", message: "The database could not be reached" });

/** Keeps each member's encrypted details. The rows are deleted for good, not marked, once they are no longer needed. */
export class PostgresTravellerStore implements TravellerStore {
  constructor(private readonly db: Database) {}

  async put(memberId: string, ciphertext: string): Promise<Result<void, TravellerStoreError>> {
    try {
      // Saving again counts as giving them again, so the age that retention goes by starts over.
      await this.db.insert(travellerDetails).values({ memberId, ciphertext }).onConflictDoUpdate({ target: travellerDetails.memberId, set: { ciphertext, createdAt: new Date() } });
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }

  async get(memberId: string): Promise<Result<string | null, TravellerStoreError>> {
    try {
      const [row] = await this.db.select({ ciphertext: travellerDetails.ciphertext }).from(travellerDetails).where(eq(travellerDetails.memberId, memberId)).limit(1);
      return ok(row?.ciphertext ?? null);
    } catch {
      return unavailable();
    }
  }

  async haveDetails(memberIds: readonly string[]): Promise<Result<readonly string[], TravellerStoreError>> {
    if (memberIds.length === 0) return ok([]);
    try {
      const rows = await this.db.select({ memberId: travellerDetails.memberId }).from(travellerDetails).where(inArray(travellerDetails.memberId, [...memberIds]));
      return ok(rows.map((row) => row.memberId));
    } catch {
      return unavailable();
    }
  }

  async remove(memberIds: readonly string[]): Promise<Result<void, TravellerStoreError>> {
    if (memberIds.length === 0) return ok(undefined);
    try {
      await this.db.delete(travellerDetails).where(inArray(travellerDetails.memberId, [...memberIds]));
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }

  async removeOlderThan(before: Date): Promise<Result<number, TravellerStoreError>> {
    try {
      const removed = await this.db.delete(travellerDetails).where(lt(travellerDetails.createdAt, before)).returning({ memberId: travellerDetails.memberId });
      return ok(removed.length);
    } catch {
      return unavailable();
    }
  }
}

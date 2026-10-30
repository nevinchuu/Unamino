import { and, asc, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { CoverStore } from "@/domain/plan/cover-store";
import type { RepositoryError } from "@/domain/plan/repository";
import type { Cover } from "@/domain/split/types";
import type { Database } from "./client";
import { planCovers } from "./schema";

const unavailable = (): Result<never, RepositoryError> => err({ code: "unavailable", message: "The database could not be reached" });

/** Reads a plan's covers in the order they were made. The plan details and the plan screen read them through this too. */
export async function readCovers(db: Database, planId: string): Promise<readonly Cover[]> {
  const rows = await db.select().from(planCovers).where(eq(planCovers.planId, planId)).orderBy(asc(planCovers.createdAt), asc(planCovers.sponsorId), asc(planCovers.beneficiaryId));
  return rows.map((row) => ({ sponsorId: row.sponsorId, beneficiaryId: row.beneficiaryId, amountBaseMinor: row.amountBaseMinor, sharePercent: row.sharePercent }));
}

export class PostgresCoverStore implements CoverStore {
  constructor(private readonly db: Database) {}

  async list(planId: string): Promise<Result<readonly Cover[], RepositoryError>> {
    try {
      return ok(await readCovers(this.db, planId));
    } catch {
      return unavailable();
    }
  }

  async save(planId: string, cover: Cover): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .insert(planCovers)
        .values({ planId, sponsorId: cover.sponsorId, beneficiaryId: cover.beneficiaryId, amountBaseMinor: cover.amountBaseMinor, sharePercent: cover.sharePercent ?? null })
        // Saying it again changes the amount but keeps its place in the order.
        .onConflictDoUpdate({ target: [planCovers.planId, planCovers.sponsorId, planCovers.beneficiaryId], set: { amountBaseMinor: cover.amountBaseMinor, sharePercent: cover.sharePercent ?? null } });
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }

  async remove(planId: string, sponsorId: string, beneficiaryId: string): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.delete(planCovers).where(and(eq(planCovers.planId, planId), eq(planCovers.sponsorId, sponsorId), eq(planCovers.beneficiaryId, beneficiaryId)));
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }
}

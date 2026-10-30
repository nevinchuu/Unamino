import type { Result } from "@/lib/result";

export interface RetentionError {
  readonly message: string;
}

/** Where old groups are found and removed. The store writes the small dispute record for a booked trip before it removes the group. */
export interface RetentionStore {
  /** Groups past their retention: a booked trip that ended long enough ago, or a group that never booked and has gone quiet. Never a group with a plan still being decided or booked. */
  expiredGroupIds(now: Date, limit: number): Promise<Result<readonly string[], RetentionError>>;
  /** Keeps a dispute record for each booked plan, then deletes the group and everything in it, in one step. */
  archiveAndDelete(groupId: string): Promise<Result<void, RetentionError>>;
  /** Deletes dispute records past their date. Returns how many. */
  purgeRecords(now: Date): Promise<Result<number, RetentionError>>;
}

export interface RetentionSweep {
  readonly groupsDeleted: number;
  readonly groupsFailed: number;
  readonly recordsPurged: number;
}

/** The scheduled clean-up of personal data: old groups first, then old dispute records. One failure does not stop the others. */
export class RetentionService {
  constructor(private readonly store: RetentionStore) {}

  async sweep(now: Date, limit: number): Promise<Result<RetentionSweep, RetentionError>> {
    const expired = await this.store.expiredGroupIds(now, limit);
    if (!expired.ok) return expired;

    let groupsDeleted = 0;
    let groupsFailed = 0;
    for (const groupId of expired.value) {
      const removed = await this.store.archiveAndDelete(groupId);
      if (removed.ok) groupsDeleted += 1;
      else groupsFailed += 1;
    }

    const purged = await this.store.purgeRecords(now);
    return { ok: true, value: { groupsDeleted, groupsFailed, recordsPurged: purged.ok ? purged.value : 0 } };
  }
}

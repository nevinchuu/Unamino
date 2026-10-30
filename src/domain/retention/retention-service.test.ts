import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { RetentionService, type RetentionError, type RetentionStore } from "./retention-service";

const NOW = new Date("2027-02-01T03:00:00Z");

class FakeStore implements RetentionStore {
  deleted: string[] = [];
  asked: { now: Date; limit: number }[] = [];
  constructor(
    private readonly expired: Result<readonly string[], RetentionError> = ok(["g1", "g2"]),
    private readonly failing: readonly string[] = [],
    private readonly purged: Result<number, RetentionError> = ok(3),
  ) {}
  async expiredGroupIds(now: Date, limit: number) {
    this.asked.push({ now, limit });
    return this.expired;
  }
  async archiveAndDelete(groupId: string): Promise<Result<void, RetentionError>> {
    if (this.failing.includes(groupId)) return err({ message: "db" });
    this.deleted.push(groupId);
    return ok(undefined);
  }
  async purgeRecords() {
    return this.purged;
  }
}

describe("RetentionService", () => {
  it("deletes each expired group and purges old dispute records", async () => {
    const store = new FakeStore();
    expect(await new RetentionService(store).sweep(NOW, 25)).toEqual({ ok: true, value: { groupsDeleted: 2, groupsFailed: 0, recordsPurged: 3 } });
    expect(store.deleted).toEqual(["g1", "g2"]);
    expect(store.asked).toEqual([{ now: NOW, limit: 25 }]);
  });

  it("carries on past a group it could not delete, and counts it", async () => {
    const store = new FakeStore(ok(["g1", "g2", "g3"]), ["g2"]);
    expect(await new RetentionService(store).sweep(NOW, 25)).toEqual({ ok: true, value: { groupsDeleted: 2, groupsFailed: 1, recordsPurged: 3 } });
    expect(store.deleted).toEqual(["g1", "g3"]);
  });

  it("still reports the groups it deleted when the record purge fails", async () => {
    const store = new FakeStore(ok(["g1"]), [], err({ message: "db" }));
    expect(await new RetentionService(store).sweep(NOW, 25)).toEqual({ ok: true, value: { groupsDeleted: 1, groupsFailed: 0, recordsPurged: 0 } });
  });

  it("gives up cleanly when it cannot even list the expired groups", async () => {
    const store = new FakeStore(err({ message: "db" }));
    expect(await new RetentionService(store).sweep(NOW, 25)).toEqual({ ok: false, error: { message: "db" } });
    expect(store.deleted).toEqual([]);
  });
});

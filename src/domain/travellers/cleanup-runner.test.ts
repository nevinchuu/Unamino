import { describe, expect, it } from "vitest";
import { TravellerCleanupRunner } from "./cleanup-runner";
import { TravellerService } from "./service";
import { MemoryTravellerStore } from "./test-support";

const cipher = { encrypt: (text: string) => `locked:${text}`, decrypt: (text: string) => ({ ok: true as const, value: text.replace("locked:", "") }) };

function setup() {
  const store = new MemoryTravellerStore();
  const service = new TravellerService({ store, cipher, clock: () => new Date("2026-10-27T00:00:00Z") });
  for (const id of ["ana", "ben", "cy"]) store.rows.set(id, "locked:x");
  return { store, runner: new TravellerCleanupRunner(service) };
}

describe("TravellerCleanupRunner", () => {
  it("deletes the details of everyone charged once the trip is booked", async () => {
    const { store, runner } = setup();
    const done = await runner.run("plan-1", 4, [{ type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 100, releaseMinor: 0 }, { memberId: "ben", captureMinor: 100, releaseMinor: 0 }] }]);
    expect(done.ok).toBe(true);
    expect([...store.rows.keys()]).toEqual(["cy"]);
  });

  it("deletes the details of everyone whose hold is let go when the plan ends", async () => {
    const { store, runner } = setup();
    await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ben", "cy"] }]);
    expect([...store.rows.keys()]).toEqual(["ana"]);
  });

  it("leaves details alone for effects that do not end anything", async () => {
    const { store, runner } = setup();
    await runner.run("plan-1", 2, [{ type: "request_approval", memberIds: ["ana"] }, { type: "place_hold", memberId: "ben", amountMinor: 100 }, { type: "book" }]);
    expect(store.rows.size).toBe(3);
  });

  it("is safe to run twice", async () => {
    const { store, runner } = setup();
    const effects = [{ type: "release_holds" as const, memberIds: ["ana"] }];
    await runner.run("plan-1", 3, effects);
    expect((await runner.run("plan-1", 3, effects)).ok).toBe(true);
    expect(store.rows.has("ana")).toBe(false);
  });

  it("reports a failure so it can be retried, without saying what was stored", async () => {
    const { store, runner } = setup();
    store.down = true;
    const done = await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ana"] }]);
    expect(done).toEqual({ ok: false, error: { message: "Traveller details could not be deleted" } });
  });
});

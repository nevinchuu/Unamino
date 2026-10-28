import { describe, expect, it } from "vitest";
import { AesGcmCipher } from "@/infrastructure/crypto/aes-gcm-cipher";
import { TRAVELLER_RETENTION_MS, TravellerService } from "./service";
import { MemoryTravellerStore, SAMPLE_DETAILS } from "./test-support";

const NOW = new Date("2026-10-28T12:00:00Z");
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);

function setup() {
  const store = new MemoryTravellerStore();
  const cipher = AesGcmCipher.fromBase64Key(Buffer.alloc(32, 7).toString("base64"));
  if (!cipher.ok) throw new Error(cipher.error);
  let now = NOW;
  const service = new TravellerService({ store, cipher: cipher.value, clock: () => now });
  /** Saves details as they were given `hours` ago. */
  const saveAgo = async (memberId: string, hours: number) => {
    store.clock = () => hoursAgo(hours);
    now = hoursAgo(hours);
    const saved = await service.save(memberId, SAMPLE_DETAILS, { passportRequired: true });
    if (!saved.ok) throw new Error("could not save");
    now = NOW;
  };
  return { store, service, saveAgo };
}

describe("deleting details that were kept too long", () => {
  it("keeps three days as the longest, which is longer than any plan lives", () => {
    expect(TRAVELLER_RETENTION_MS).toBe(72 * 60 * 60_000);
  });

  it("deletes old details and keeps recent ones, and says how many went", async () => {
    const { store, service, saveAgo } = setup();
    await saveAgo("old", 80);
    await saveAgo("recent", 5);

    expect(await service.purgeStale(NOW)).toEqual({ ok: true, value: 1 });
    expect([...store.rows.keys()]).toEqual(["recent"]);
  });

  it("keeps details that are just inside the limit", async () => {
    const { store, service, saveAgo } = setup();
    await saveAgo("edge", 71);
    expect(await service.purgeStale(NOW)).toEqual({ ok: true, value: 0 });
    expect(store.rows.has("edge")).toBe(true);
  });

  it("counts details given again as new, so a person who plans another trip is not caught by their first", async () => {
    const { store, service, saveAgo } = setup();
    await saveAgo("again", 100);
    await saveAgo("again", 2);
    expect(await service.purgeStale(NOW)).toEqual({ ok: true, value: 0 });
    expect(store.rows.has("again")).toBe(true);
  });

  it("reports a store that cannot be reached", async () => {
    const { store, service } = setup();
    store.down = true;
    expect(await service.purgeStale(NOW)).toEqual({ ok: false, error: { kind: "unavailable" } });
  });
});

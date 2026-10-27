import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmCipher } from "@/infrastructure/crypto/aes-gcm-cipher";
import { TravellerService } from "./service";
import { MemoryTravellerStore, SAMPLE_DETAILS } from "./test-support";

const NOW = new Date("2026-10-27T12:00:00.000Z");

function setup() {
  const made = AesGcmCipher.fromBase64Key(randomBytes(32).toString("base64"));
  if (!made.ok) throw new Error(made.error);
  const store = new MemoryTravellerStore();
  const service = new TravellerService({ store, cipher: made.value, clock: () => NOW });
  return { store, service };
}

describe("TravellerService", () => {
  it("keeps details locked, and hands them back for booking", async () => {
    const { store, service } = setup();
    expect(await service.save("ana", SAMPLE_DETAILS, { passportRequired: true })).toEqual({ ok: true, value: undefined });

    const stored = store.rows.get("ana") ?? "";
    expect(stored).not.toContain("Daniel");
    expect(stored).not.toContain("K1234567A");
    expect(await service.load("ana")).toEqual({ ok: true, value: SAMPLE_DETAILS });
  });

  it("gives back null for someone who has not given details", async () => {
    expect(await setup().service.load("ben")).toEqual({ ok: true, value: null });
  });

  it("saves nothing when the details are wrong, and says what to fix", async () => {
    const { store, service } = setup();
    const result = await service.save("ana", { ...SAMPLE_DETAILS, birthday: "2030-01-01" }, { passportRequired: true });
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid", fields: { birthday: expect.any(String) } } });
    expect(store.rows.size).toBe(0);
  });

  it("replaces earlier details when saved again", async () => {
    const { service } = setup();
    await service.save("ana", SAMPLE_DETAILS, { passportRequired: true });
    await service.save("ana", { ...SAMPLE_DETAILS, firstName: "Danny" }, { passportRequired: true });
    expect(await service.load("ana")).toMatchObject({ ok: true, value: { firstName: "Danny" } });
  });

  it("does not open one member's details as another's, even if the row is copied across", async () => {
    const { store, service } = setup();
    await service.save("ana", SAMPLE_DETAILS, { passportRequired: true });
    store.rows.set("ben", store.rows.get("ana") ?? "");
    expect(await service.load("ben")).toEqual({ ok: false, error: { kind: "unreadable" } });
  });

  it("reports stored text that is not details as unreadable, not as a crash", async () => {
    const { store, service } = setup();
    store.rows.set("ana", "not even close");
    expect(await service.load("ana")).toEqual({ ok: false, error: { kind: "unreadable" } });
  });

  it("says who has given details without opening them", async () => {
    const { service } = setup();
    await service.save("ana", SAMPLE_DETAILS, { passportRequired: false });
    const have = await service.haveDetails(["ana", "ben"]);
    expect(have.ok && [...have.value]).toEqual(["ana"]);
  });

  it("deletes details, and deleting ones that are not there is fine", async () => {
    const { store, service } = setup();
    await service.save("ana", SAMPLE_DETAILS, { passportRequired: true });
    expect(await service.forget(["ana", "ben"])).toEqual({ ok: true, value: undefined });
    expect(store.rows.size).toBe(0);
  });

  it("answers a store that is down with 'unavailable' on every call", async () => {
    const { store, service } = setup();
    store.down = true;
    const unavailable = { ok: false, error: { kind: "unavailable" } };
    expect(await service.save("ana", SAMPLE_DETAILS, { passportRequired: true })).toEqual(unavailable);
    expect(await service.load("ana")).toEqual(unavailable);
    expect(await service.haveDetails(["ana"])).toEqual(unavailable);
    expect(await service.forget(["ana"])).toEqual(unavailable);
  });
});

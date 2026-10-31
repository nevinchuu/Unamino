import { describe, expect, it } from "vitest";
import type { CoverDto, PersonDto } from "@/domain/plan/view";
import { coverAmount, coverChangeFor, coverNotice, coverTargets, parseMoney } from "./cover-choice";

const person = (id: string, overrides: Partial<PersonDto> = {}): PersonDto => ({
  id, name: id, isMe: false, agreement: "pending", approval: "pending", holdPlaced: false, shareMinor: 10_000, currency: "USD",
  approvedMinor: null, chargedMinor: null, lines: [], ownPartMinor: 10_000, previousShareMinor: null, coveredByMe: null, ...overrides,
});
const cover = (sponsorId: string, beneficiaryId: string, amountMinor: number): CoverDto => ({ sponsorId, sponsorName: sponsorId, beneficiaryId, beneficiaryName: beneficiaryId, amountMinor, whole: false, percent: null });

const people = [person("ana", { isMe: true }), person("ben"), person("cai")];

describe("coverTargets", () => {
  it("offers every friend when nobody covers anybody", () => {
    expect(coverTargets(people, []).map((t) => [t.person.id, t.blockedReason])).toEqual([["ben", null], ["cai", null]]);
  });

  it("blocks a friend who is covering someone, and says whom", () => {
    const targets = coverTargets(people, [cover("ben", "cai", 5_000)]);
    expect(targets.find((t) => t.person.id === "ben")?.blockedReason).toBe("Already covering cai");
  });

  it("blocks everyone while the viewer is being covered", () => {
    const targets = coverTargets(people, [cover("ben", "ana", 5_000)]);
    expect(targets.every((t) => t.blockedReason?.startsWith("You're being covered"))).toBe(true);
  });

  it("blocks a friend whose price is not ready", () => {
    const targets = coverTargets([people[0], person("ben", { ownPartMinor: null })], []);
    expect(targets[0].blockedReason).toBe("Their price isn't ready yet");
  });

  it("adds up what other friends already cover, leaving out the viewer's own cover", () => {
    const targets = coverTargets(people, [cover("cai", "ben", 3_000), cover("ana", "ben", 2_000)]);
    expect(targets.find((t) => t.person.id === "ben")?.othersCoverMinor).toBe(3_000);
  });
});

describe("coverAmount", () => {
  it("covers all that is left", () => expect(coverAmount("all", 10_000, 3_000, null)).toBe(7_000));
  it("covers half of their part, rounded down", () => expect(coverAmount("half", 10_001, 0, null)).toBe(5_000));
  it("never covers more than is left", () => {
    expect(coverAmount("half", 10_000, 8_000, null)).toBe(2_000);
    expect(coverAmount("custom", 10_000, 0, 99_999)).toBe(10_000);
  });
  it("covers nothing for a custom amount that is not there yet", () => expect(coverAmount("custom", 10_000, 0, null)).toBe(0));
});

describe("coverChangeFor", () => {
  it("asks for the whole share, or half as a percent that follows the price", () => {
    expect(coverChangeFor("all", null)).toEqual({ kind: "all" });
    expect(coverChangeFor("half", null)).toEqual({ kind: "percent", percent: 50 });
  });
  it("asks for a fixed amount only once there is one", () => {
    expect(coverChangeFor("custom", null)).toBeNull();
    expect(coverChangeFor("custom", 2_500)).toEqual({ kind: "amount", amountMinor: 2_500 });
  });
});

describe("parseMoney", () => {
  it.each([["12", 1200], ["12.5", 1250], ["$12.50", 1250], ["1,200.05", 120005], [" 7 ", 700]])("reads %s", (text, minor) => expect(parseMoney(text, "USD")).toBe(minor));
  it.each(["", "0", "0.00", "-5", "abc", "1.234", "1e3"])("refuses %j", (text) => expect(parseMoney(text, "USD")).toBeNull());
  it("reads a zero-decimal currency in whole units", () => {
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("5.5", "JPY")).toBeNull();
  });
});

describe("coverNotice", () => {
  it("says what happened in plain words", () => {
    expect(coverNotice({ kind: "all" }, "Ben", "")).toBe("You're covering Ben's whole share.");
    expect(coverNotice({ kind: "percent", percent: 50 }, "Ben", "")).toBe("You're covering half of Ben's share.");
    expect(coverNotice({ kind: "amount", amountMinor: 2500 }, "Ben", "$25.00")).toBe("You're covering $25.00 of Ben's share.");
    expect(coverNotice({ kind: "stop" }, "Ben", "")).toBe("You're no longer covering Ben's share.");
  });
});

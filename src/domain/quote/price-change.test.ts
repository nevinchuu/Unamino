import { describe, expect, it } from "vitest";
import { comparePrice, toSeenQuote } from "./price-change";
import type { MemberQuote } from "./types";

const quote = (overrides: Partial<MemberQuote> = {}): MemberQuote => ({
  memberId: "ana",
  currency: "USD",
  lines: [
    { itemId: "flight", label: "Flight", baseMinor: 18000 },
    { itemId: "room", label: "Room", baseMinor: 14000 },
  ],
  baseShareMinor: 32000,
  shareMinor: 32000,
  fxRate: 1,
  fxSource: "test",
  budget: null,
  ...overrides,
});

const seen = (q: MemberQuote) => toSeenQuote(q, new Date("2026-10-27T01:00:00Z"));

describe("toSeenQuote", () => {
  it("keeps what is needed to compare later", () => {
    expect(seen(quote())).toEqual({ currency: "USD", shareMinor: 32000, lines: quote().lines, seenAt: "2026-10-27T01:00:00.000Z" });
  });
});

describe("comparePrice", () => {
  it("has nothing to compare on the first view", () => {
    expect(comparePrice(null, quote())).toEqual({ kind: "first_view" });
  });

  it("reports no change when nothing moved", () => {
    expect(comparePrice(seen(quote()), quote())).toEqual({ kind: "unchanged" });
  });

  it("reports a rise with the line that caused it", () => {
    const now = quote({
      lines: [{ itemId: "flight", label: "Flight", baseMinor: 18000 }, { itemId: "room", label: "Room", baseMinor: 15200 }],
      shareMinor: 33200,
    });
    expect(comparePrice(seen(quote()), now)).toEqual({
      kind: "changed",
      shareDeltaMinor: 1200,
      lines: [{ itemId: "room", label: "Room", previousMinor: 14000, currentMinor: 15200, deltaMinor: 1200 }],
    });
  });

  it("reports a fall as a negative change", () => {
    const now = quote({ lines: [{ itemId: "flight", label: "Flight", baseMinor: 17000 }, { itemId: "room", label: "Room", baseMinor: 14000 }], shareMinor: 31000 });
    expect(comparePrice(seen(quote()), now)).toMatchObject({ kind: "changed", shareDeltaMinor: -1000 });
  });

  it("reports added and removed lines when the selection changed", () => {
    const now = quote({
      lines: [{ itemId: "flight", label: "Flight", baseMinor: 18000 }, { itemId: "tour", label: "Tour", baseMinor: 3000 }],
      shareMinor: 21000,
    });
    const change = comparePrice(seen(quote()), now);
    expect(change).toMatchObject({ kind: "changed", shareDeltaMinor: -11000 });
    expect(change.kind === "changed" && change.lines).toEqual([
      { itemId: "tour", label: "Tour", previousMinor: null, currentMinor: 3000, deltaMinor: 3000 },
      { itemId: "room", label: "Room", previousMinor: 14000, currentMinor: null, deltaMinor: -14000 },
    ]);
  });

  it("still reports a change when lines swapped but the total stayed the same", () => {
    const now = quote({ lines: [{ itemId: "flight2", label: "Flight", baseMinor: 18000 }, { itemId: "room", label: "Room", baseMinor: 14000 }] });
    expect(comparePrice(seen(quote()), now)).toMatchObject({ kind: "changed", shareDeltaMinor: 0 });
  });

  it("does not compare amounts in different currencies", () => {
    expect(comparePrice(seen(quote()), quote({ currency: "SGD" }))).toEqual({ kind: "currency_changed", from: "USD", to: "SGD" });
  });

  it("shows a change in the member's currency even when the base lines are identical, such as an exchange rate move", () => {
    const sgd = quote({ currency: "SGD", shareMinor: 43200, fxRate: 1.35 });
    const moved = quote({ currency: "SGD", shareMinor: 44800, fxRate: 1.4 });
    expect(comparePrice(seen(sgd), moved)).toEqual({ kind: "changed", shareDeltaMinor: 1600, lines: [] });
  });
});

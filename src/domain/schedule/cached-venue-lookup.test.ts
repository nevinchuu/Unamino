import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { CachedVenueLookup } from "./cached-venue-lookup";
import { parseSuggestionText } from "./suggestion-schema";
import { venue } from "./test-support";
import type { VenueLookup, VenueQuery } from "./venue";

class CountingLookup implements VenueLookup {
  calls = 0;
  constructor(private readonly respond: () => ReturnType<VenueLookup["search"]>) {}
  async search(query: VenueQuery) {
    void query;
    this.calls += 1;
    return this.respond();
  }
}

describe("CachedVenueLookup", () => {
  const found = ok([venue("Thip Samai")]);

  it("asks once for the same place and serves the rest from memory, ignoring case and spacing", async () => {
    const inner = new CountingLookup(async () => found);
    const cached = new CachedVenueLookup(inner);
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    await cached.search({ name: " thip samai ", city: "BANGKOK" });
    expect(inner.calls).toBe(1);
  });

  it("asks again for a different place or city", async () => {
    const inner = new CountingLookup(async () => found);
    const cached = new CachedVenueLookup(inner);
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    await cached.search({ name: "Wat Pho", city: "Bangkok" });
    await cached.search({ name: "Thip Samai", city: "Phuket" });
    expect(inner.calls).toBe(3);
  });

  it("asks again once the stored answer is too old", async () => {
    let now = 0;
    const inner = new CountingLookup(async () => found);
    const cached = new CachedVenueLookup(inner, 1000, () => now);
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    now = 999;
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    expect(inner.calls).toBe(1);
    now = 1000;
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    expect(inner.calls).toBe(2);
  });

  it("does not remember failures", async () => {
    const inner = new CountingLookup(async () => err({ code: "lookup_unavailable" as const, message: "down" }));
    const cached = new CachedVenueLookup(inner);
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    await cached.search({ name: "Thip Samai", city: "Bangkok" });
    expect(inner.calls).toBe(2);
  });

  it("remembers an empty result, so a place that does not exist is not searched for repeatedly", async () => {
    const inner = new CountingLookup(async () => ok([]));
    const cached = new CachedVenueLookup(inner);
    await cached.search({ name: "Nowhere", city: "Bangkok" });
    await cached.search({ name: "Nowhere", city: "Bangkok" });
    expect(inner.calls).toBe(1);
  });
});

describe("suggestion output schema", () => {
  const valid = { gapId: "gap-1", venueName: "Thip Samai", category: " Meal ", startTime: "18:00", durationMinutes: 90, why: "Famous pad thai" };

  it("parses plain and fenced JSON and lowercases the category", () => {
    const text = JSON.stringify({ suggestions: [valid] });
    const plain = parseSuggestionText(text);
    expect(plain.ok && plain.value.suggestions[0].category).toBe("meal");
    expect(parseSuggestionText("```json\n" + text + "\n```").ok).toBe(true);
  });

  it("rejects fields that would let the model supply facts: price, address, hours, link", () => {
    for (const extra of [{ priceMinor: 100 }, { address: "x" }, { openingHours: "9-5" }, { url: "http://x" }]) {
      expect(parseSuggestionText(JSON.stringify({ suggestions: [{ ...valid, ...extra }] })).ok).toBe(false);
    }
  });

  it("rejects bad times, durations and too many suggestions", () => {
    const parses = (suggestion: object) => parseSuggestionText(JSON.stringify({ suggestions: [suggestion] })).ok;
    expect(parses({ ...valid, startTime: "6pm" })).toBe(false);
    expect(parses({ ...valid, startTime: "24:00" })).toBe(false);
    expect(parses({ ...valid, durationMinutes: 10 })).toBe(false);
    expect(parses({ ...valid, durationMinutes: 500 })).toBe(false);
    expect(parses({ ...valid, durationMinutes: 90.5 })).toBe(false);
    expect(parseSuggestionText(JSON.stringify({ suggestions: Array.from({ length: 13 }, () => valid) })).ok).toBe(false);
  });

  it("accepts no suggestions, and reports text that is not JSON", () => {
    expect(parseSuggestionText('{"suggestions":[]}').ok).toBe(true);
    const bad = parseSuggestionText("Here are some ideas!");
    expect(bad.ok ? null : bad.error.code).toBe("invalid_json");
  });
});

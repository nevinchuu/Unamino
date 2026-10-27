import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPlan } from "@/domain/planner/build-plan";
import { prefilterOffers } from "@/domain/planner/prefilter";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, FX, MEMBER_IDS, MEMBERS, NOW } from "@/domain/planner/test-support";
import { buildSchedule } from "@/domain/schedule/build-schedule";
import { suggestFreeTime } from "@/domain/schedule/suggest-free-time";
import { searchForTrip } from "@/domain/trip/search";
import { LiteApiOfferSource } from "@/infrastructure/liteapi/liteapi-offer-source";
import { GooglePlacesLookup } from "@/infrastructure/google-places/places-lookup";
import { museConfigFromEnv } from "./muse-config";
import { MuseHttp, type Completion, type CompletionRequest, type MuseError, type MuseUsage } from "./muse-http";
import { MusePlanner, type CompletionClient } from "./muse-planner";
import type { Result } from "@/lib/result";

/**
 * Talks to the real Muse model, so it costs a few cents and is skipped unless asked for:
 *   MUSE_LIVE=1 MUSE_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run muse-planner.live
 * It uses only the Bangkok fixture trip and fixture chat, never real traveller data.
 */
const LIVE = process.env.MUSE_LIVE === "1";
const MEMBER_LIST = [...MEMBER_IDS];

const CHAT = [
  { memberId: "nevin", text: "@trippy plan Bangkok for the 4 of us, Fri 11 to Sun 13 Dec, around $400 each" },
  { memberId: "ana", text: "I can only fly after 6pm on Friday" },
  { memberId: "ben", text: "Max $350 for me" },
  { memberId: "jia", text: "I'd like my own room. Not into cooking classes" },
];

interface Recorded {
  readonly step: string;
  readonly request: CompletionRequest;
  readonly completion: Result<Completion, MuseError>;
}

describe.skipIf(!LIVE)("MusePlanner against the real model", () => {
  // Describe bodies run even when skipped, so a missing key must not throw here.
  const config = museConfigFromEnv(process.env);

  const recorded: Recorded[] = [];
  const usages: MuseUsage[] = [];
  let step = "";
  const http = new MuseHttp({ ...(config.ok ? config.value : { apiKey: "" }), onUsage: (usage) => usages.push(usage) });
  const client: CompletionClient = {
    async complete(request) {
      const completion = await http.complete(request);
      recorded.push({ step, request, completion });
      return completion;
    },
  };
  const planner = new MusePlanner(client);
  const report: Record<string, unknown> = {};

  it("reads the chat into the constraints the wireframe expects", { timeout: 180_000 }, async () => {
    if (!config.ok) throw new Error(config.error.message);
    step = "extract";
    const result = await planner.extractConstraints({ memberIds: MEMBER_LIST, messages: CHAT, defaultCurrency: "USD" });
    report.extract = result;
    expect(result.ok && result.value).toEqual(BANGKOK_CONSTRAINTS);
  });

  it("proposes a plan that survives the validator and serves everyone", { timeout: 240_000 }, async () => {
    step = "propose";
    const { offers, prunedCount } = prefilterOffers({ offers: BANGKOK_OFFERS, constraints: BANGKOK_CONSTRAINTS, now: NOW });
    const result = await buildPlan({ planner, members: MEMBERS, constraints: BANGKOK_CONSTRAINTS, offers, fx: FX, requiredKinds: ["flight", "hotel"], now: NOW });
    report.propose = result.ok
      ? { ok: true, attempts: result.value.attempts, totalMinor: result.value.plan.totalMinor, violations: result.value.violations.map((v) => v.message), picks: result.value.plan.picks.map((p) => ({ offer: p.offer.id, members: p.memberIds })), prunedCount }
      : result;
    expect(result.ok).toBe(true);
    if (result.ok) report.shares = result.value.shares.map((share) => ({ member: share.memberId, shareMinor: share.shareMinor }));

    // The schedule of that plan gives the real free gaps to fill.
    if (result.ok) {
      const schedule = buildSchedule(result.value.plan);
      report.gaps = schedule.ok ? schedule.value.gaps : schedule;
    }
  });

  it("suggests named places and Google confirms which of them exist and are open", { timeout: 240_000 }, async () => {
    step = "suggest";
    const gaps = (report.gaps as { id: string; date: string; startTime: string; endTime: string; minutes: number }[] | undefined) ?? [];
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!placesKey || gaps.length === 0) {
      report.suggest = { skipped: !placesKey ? "no GOOGLE_PLACES_API_KEY" : "no gaps" };
      return;
    }
    const result = await suggestFreeTime({
      planner,
      lookup: new GooglePlacesLookup({ apiKey: placesKey }),
      gaps,
      memberIds: MEMBER_LIST,
      constraints: BANGKOK_CONSTRAINTS,
      city: "Bangkok",
      now: NOW,
    });
    report.suggest = result.ok
      ? { attempts: result.value.attempts, verified: result.value.verified.map((v) => ({ gap: v.gapId, venue: v.venue.name, start: v.startTime, end: v.endTime, category: v.category })), rejected: result.value.rejected.map((r) => ({ venue: r.suggestion.venueName, code: r.code, message: r.message })) }
      : result;
    expect(result.ok).toBe(true);
  });

  it("goes from the chat to real flights and hotels to a plan the code accepts", { timeout: 420_000 }, async () => {
    const trip = { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13" };
    const liteKey = process.env.LITEAPI_KEY;
    if (!liteKey) {
      report.pipeline = { skipped: "no LITEAPI_KEY" };
      return;
    }
    step = "pipeline";
    const source = new LiteApiOfferSource({ apiKey: liteKey, currency: "USD", guestNationality: "SG" });
    const searched = await searchForTrip(source, trip, MEMBERS.length);
    if (!searched.ok) throw new Error(searched.error.message);

    const now = new Date();
    const kept = prefilterOffers({ offers: searched.value.offers, constraints: BANGKOK_CONSTRAINTS, now });
    const built = await buildPlan({ planner, members: MEMBERS, constraints: BANGKOK_CONSTRAINTS, offers: kept.offers, fx: FX, requiredKinds: ["flight", "hotel"], now });
    report.pipeline = {
      searches: searched.value.searches.map((s) => ({ kind: s.query.kind, guests: s.query.guests, found: s.offers.length })),
      failures: searched.value.failures.map((f) => ({ kind: f.query.kind, guests: f.query.guests, error: f.error.message })),
      totalOffers: searched.value.offers.length,
      sentToMuse: kept.offers.length,
      plan: built.ok
        ? { attempts: built.value.attempts, totalMinor: built.value.plan.totalMinor, currency: built.value.plan.currency, violations: built.value.violations.map((v) => v.message), picks: built.value.plan.picks.map((p) => ({ title: p.offer.title, members: p.memberIds, totalMinor: p.offer.totalMinor })) }
        : built.error,
    };
    expect(built.ok).toBe(true);
  });

  it("records what happened", () => {
    report.usage = { calls: usages.length, promptTokens: usages.reduce((n, u) => n + u.promptTokens, 0), completionTokens: usages.reduce((n, u) => n + u.completionTokens, 0), reasoningTokens: usages.reduce((n, u) => n + u.reasoningTokens, 0) };
    const out = process.env.MUSE_LIVE_OUT;
    if (out) writeFileSync(out, JSON.stringify({ report, recorded }, null, 2));
  });
});

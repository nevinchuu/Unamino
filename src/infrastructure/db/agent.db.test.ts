import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUsageMeter, runAgent, startAgentRun, type AgentDeps } from "@/domain/agent/run-agent";
import { StaticFxRates } from "@/domain/agent/static-fx";
import { FakeOfferSource, NOW, RecordingPlanner, ScriptedChatModel, planTurns, proposeFrom, says, search, type ChatStep, type PlannerBehaviour } from "@/domain/agent/test-support";
import type { Member } from "@/domain/group/types";
import type { FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";
import { BANGKOK_OFFERS, pick } from "@/domain/planner/test-support";
import { ok } from "@/lib/result";
import { connectDatabase, type DatabaseHandle } from "./client";
import { PostgresBriefRepository } from "./postgres-brief-repository";
import { PostgresConstraintRepository } from "./postgres-constraint-repository";
import { PostgresGroupRepository } from "./postgres-group-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";
import { PostgresPlanRepository } from "./postgres-plan-repository";
import { PostgresPlanStore } from "./postgres-plan-store";
import { PostgresRunRepository } from "./postgres-run-repository";
import { PostgresSearchStore } from "./postgres-search-store";
import { agentRuns, groups, memberConstraints, messages, offers as offersTable, offerSearches, planMembers, planPicks, plans, tripBriefs } from "./schema";

/**
 * Runs against the real database, so it is skipped unless asked for:
 *   DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run agent.db
 * Everything it creates is deleted afterwards. It uses made-up people and a scripted model; nothing leaves the database.
 */
const ENABLED = process.env.DB_TESTS === "1";
const TRIP = { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN", departDate: "2026-12-11", returnDate: "2026-12-13" };

const flight4 = BANGKOK_OFFERS.find((o): o is FlightOffer => o.id === "fx-flt-evening") as FlightOffer;
const triple = BANGKOK_OFFERS.find((o): o is HotelOffer => o.id === "fx-htl-triple") as HotelOffer;
const single = BANGKOK_OFFERS.find((o): o is HotelOffer => o.id === "fx-htl-single") as HotelOffer;
const OFFERS_FOR_FIVE: Offer[] = [{ ...flight4, id: "flt-5", listingId: "flt-5", guests: 5, totalMinor: 90000 }, triple, single, { ...single, id: "single-5", listingId: "single-5" }];

/** The model's answers, written in the m1, m2, ... stand-ins it is shown. */
const behaviour: PlannerBehaviour = {
  constraints: () => ok({ m2: { outboundDeparture: { after: "18:00" } }, m3: { budgetCap: { amountMinor: 35000, currency: "USD" } }, m4: { ownRoom: true, skipActivityCategories: ["cooking"] } }),
  plan: (input) => {
    const all = input.memberIds;
    return ok(
      all.length === 5
        ? { title: "Bangkok weekend", picks: [pick("flt-5", all), pick("fx-htl-triple", all.slice(0, 3)), pick("fx-htl-single", [all[3]]), pick("single-5", [all[4]])] }
        : { title: "Bangkok weekend", picks: [pick("fx-flt-evening", all), pick("fx-htl-triple", all.slice(0, 3)), pick("fx-htl-single", [all[3]])] },
    );
  },
};

describe.skipIf(!ENABLED)("the agent on the real database", () => {
  let handle: DatabaseHandle;
  let groupRepo: PostgresGroupRepository;
  let messageRepo: PostgresMessageRepository;
  let runRepo: PostgresRunRepository;
  let briefRepo: PostgresBriefRepository;
  let constraintRepo: PostgresConstraintRepository;
  let searchStore: PostgresSearchStore;
  let planStore: PostgresPlanStore;
  let planRepo: PostgresPlanRepository;
  const created: string[] = [];

  async function newGroup(names: readonly string[] = ["Nevin", "Ana", "Ben", "Jia"]) {
    const result = await groupRepo.create({ name: "agent-db-test", baseCurrency: "USD", organiser: { displayName: names[0], currency: "USD" } });
    if (!result.ok) throw new Error(result.error.message);
    created.push(result.value.group.id);
    const people: Member[] = [result.value.organiser];
    for (const name of names.slice(1)) {
      const joined = await groupRepo.joinWithLink(result.value.joinToken, { displayName: name, currency: "USD" });
      if (!joined.ok) throw new Error(joined.error.message);
      people.push(joined.value.member);
    }
    return { groupId: result.value.group.id, joinToken: result.value.joinToken, people };
  }

  const say = async (groupId: string, memberId: string, body: string) => {
    const posted = await messageRepo.post({ groupId, memberId, body });
    if (!posted.ok) throw new Error(posted.error.message);
    return posted.value;
  };

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 12);
    const { db } = handle;
    groupRepo = new PostgresGroupRepository(db);
    messageRepo = new PostgresMessageRepository(db);
    runRepo = new PostgresRunRepository(db);
    briefRepo = new PostgresBriefRepository(db);
    constraintRepo = new PostgresConstraintRepository(db);
    searchStore = new PostgresSearchStore(db);
    planStore = new PostgresPlanStore(db);
    planRepo = new PostgresPlanRepository(db);
  });

  afterAll(async () => {
    if (!handle) return;
    if (created.length > 0) {
      // Plans reference briefs without cascading, so they go first; the rest follows the group.
      await handle.db.delete(plans).where(inArray(plans.groupId, created));
      await handle.db.delete(groups).where(inArray(groups.id, created));
    }
    await handle.close();
  }, 60_000);

  describe("runs", () => {
    it("starts a run, refuses a second one in the same group, and allows another once the first finishes", async () => {
      const { groupId, people } = await newGroup();
      const [a, b, c] = await Promise.all([1, 2, 3].map((n) => say(groupId, people[0].id, `@trippy try ${n}`)));
      const now = new Date();
      const first = await runRepo.start({ groupId, triggerMessageId: a.id, requestedByMemberId: people[0].id, now, staleAfterMs: 300_000 });
      const second = await runRepo.start({ groupId, triggerMessageId: b.id, requestedByMemberId: people[0].id, now, staleAfterMs: 300_000 });
      expect(first.ok && first.value.status).toBe("started");
      expect(second.ok && second.value.status).toBe("busy");

      if (!first.ok || first.value.status !== "started") throw new Error("expected a started run");
      await runRepo.finish(first.value.run.id, { status: "done", usage: { calls: 3, promptTokens: 100, completionTokens: 200, reasoningTokens: 50 }, model: "muse-spark-1.3" }, now);
      const [row] = await handle.db.select().from(agentRuns).where(eq(agentRuns.id, first.value.run.id));
      expect(row).toMatchObject({ status: "done", promptTokens: 100, completionTokens: 200, reasoningTokens: 50, model: "muse-spark-1.3" });
      expect(row.finishedAt).not.toBeNull();

      const third = await runRepo.start({ groupId, triggerMessageId: c.id, requestedByMemberId: null, now, staleAfterMs: 300_000 });
      expect(third.ok && third.value.status).toBe("started");
    }, 60_000);

    it("counts recent runs for the group and for one person, within the window only", async () => {
      const { groupId, people } = await newGroup();
      const other = await newGroup(["Zed"]);
      const now = new Date();
      const begin = async (gid: string, memberId: string | null, at: Date, body: string, who = people[0].id) => {
        const message = await say(gid, who, body);
        const started = await runRepo.start({ groupId: gid, triggerMessageId: message.id, requestedByMemberId: memberId, now: at, staleAfterMs: 300_000 });
        if (!started.ok || started.value.status !== "started") throw new Error("expected a started run");
        await runRepo.finish(started.value.run.id, { status: "done", usage: { calls: 1, promptTokens: 1, completionTokens: 1, reasoningTokens: 0 } }, at);
      };
      await begin(groupId, people[0].id, new Date(now.getTime() - 5 * 60_000), "@trippy one");
      await begin(groupId, people[0].id, new Date(now.getTime() - 4 * 60_000), "@trippy two");
      await begin(groupId, people[1].id, new Date(now.getTime() - 3 * 60_000), "@trippy three", people[1].id);
      await begin(groupId, people[0].id, new Date(now.getTime() - 3 * 3_600_000), "@trippy old");
      await begin(other.groupId, other.people[0].id, new Date(now.getTime() - 60_000), "@trippy elsewhere", other.people[0].id);

      const since = new Date(now.getTime() - 3_600_000);
      expect(await runRepo.countRecent(groupId, people[0].id, since)).toEqual({ ok: true, value: { group: 3, member: 2 } });
      expect(await runRepo.countRecent(groupId, null, since)).toEqual({ ok: true, value: { group: 3, member: 0 } });
    }, 60_000);

    it("says whether the agent is working for a group, and stops saying so when the run ends or goes stale", async () => {
      const { groupId, people } = await newGroup();
      const other = await newGroup();
      const message = await say(groupId, people[0].id, "@trippy go");
      const start = new Date("2026-10-27T00:00:00Z");
      expect(await runRepo.isRunning(groupId, start, 300_000)).toBe(false);

      const started = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now: start, staleAfterMs: 300_000 });
      if (!started.ok || started.value.status !== "started") throw new Error("expected a started run");
      expect(await runRepo.isRunning(groupId, new Date(start.getTime() + 60_000), 300_000)).toBe(true);
      // Another group's run is not this group's.
      expect(await runRepo.isRunning(other.groupId, new Date(start.getTime() + 60_000), 300_000)).toBe(false);
      // A run that has gone on longer than it should is treated as dead, the same rule that frees the group.
      expect(await runRepo.isRunning(groupId, new Date(start.getTime() + 301_000), 300_000)).toBe(false);

      await runRepo.finish(started.value.run.id, { status: "done", usage: { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 } }, start);
      expect(await runRepo.isRunning(groupId, new Date(start.getTime() + 60_000), 300_000)).toBe(false);
    }, 60_000);

    it("lets only one of two simultaneous calls start", async () => {
      const { groupId, people } = await newGroup();
      const [a, b] = await Promise.all([say(groupId, people[0].id, "@trippy one"), say(groupId, people[1].id, "@trippy two")]);
      const now = new Date();
      const results = await Promise.all([a, b].map((m) => runRepo.start({ groupId, triggerMessageId: m.id, requestedByMemberId: null, now, staleAfterMs: 300_000 })));
      const statuses = results.map((r) => (r.ok ? r.value.status : "error")).sort();
      expect(statuses).toEqual(["busy", "started"]);
    }, 60_000);

    it("handles each message once", async () => {
      const { groupId, people } = await newGroup();
      const message = await say(groupId, people[0].id, "@trippy go");
      const now = new Date();
      const first = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now, staleAfterMs: 300_000 });
      if (!first.ok || first.value.status !== "started") throw new Error("expected a started run");
      await runRepo.finish(first.value.run.id, { status: "done", usage: { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 } }, now);
      const again = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now, staleAfterMs: 300_000 });
      expect(again.ok && again.value.status).toBe("duplicate");
    }, 60_000);

    it("writes off a run that never finished, so it cannot block the group for good", async () => {
      const { groupId, people } = await newGroup();
      const [a, b] = await Promise.all([say(groupId, people[0].id, "@trippy first"), say(groupId, people[0].id, "@trippy second")]);
      const start = new Date("2026-10-27T00:00:00Z");
      const stuck = await runRepo.start({ groupId, triggerMessageId: a.id, requestedByMemberId: null, now: start, staleAfterMs: 300_000 });
      if (!stuck.ok || stuck.value.status !== "started") throw new Error("expected a started run");

      const soon = await runRepo.start({ groupId, triggerMessageId: b.id, requestedByMemberId: null, now: new Date(start.getTime() + 60_000), staleAfterMs: 300_000 });
      expect(soon.ok && soon.value.status).toBe("busy");

      const c = await say(groupId, people[0].id, "@trippy third");
      const later = await runRepo.start({ groupId, triggerMessageId: c.id, requestedByMemberId: null, now: new Date(start.getTime() + 301_000), staleAfterMs: 300_000 });
      expect(later.ok && later.value.status).toBe("started");
      const [old] = await handle.db.select().from(agentRuns).where(eq(agentRuns.id, stuck.value.run.id));
      expect(old).toMatchObject({ status: "failed", errorCode: "timed_out" });
    }, 60_000);
  });

  describe("briefs and constraints", () => {
    it("keeps every version of the brief and returns the newest, with unknown fields left unknown", async () => {
      const { groupId, people } = await newGroup();
      const message = await say(groupId, people[0].id, "@trippy plan");
      const started = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now: new Date(), staleAfterMs: 300_000 });
      if (!started.ok || started.value.status !== "started") throw new Error("expected a started run");
      const runId = started.value.run.id;

      expect(await briefRepo.latest(groupId)).toBeNull();
      const v1 = await briefRepo.save({ groupId, fields: { destinationCity: "Bangkok" }, headcount: 4, openQuestions: ["Which dates?"], runId });
      const v2 = await briefRepo.save({ groupId, fields: TRIP, headcount: 5, openQuestions: [], runId });
      expect(v1.ok && v1.value.version).toBe(1);
      expect(v2.ok && v2.value.version).toBe(2);

      const latest = await briefRepo.latest(groupId);
      expect(latest).toMatchObject({ version: 2, headcount: 5, fields: TRIP });
      const rows = await handle.db.select().from(tripBriefs).where(eq(tripBriefs.groupId, groupId));
      expect(rows.find((r) => r.version === 1)).toMatchObject({ destinationCity: "Bangkok", departDate: null, openQuestions: ["Which dates?"] });
    }, 60_000);

    it("gives two simultaneous saves different version numbers instead of failing", async () => {
      const { groupId, people } = await newGroup();
      const message = await say(groupId, people[0].id, "@trippy plan");
      const started = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now: new Date(), staleAfterMs: 300_000 });
      if (!started.ok || started.value.status !== "started") throw new Error("expected a started run");
      const save = () => briefRepo.save({ groupId, fields: TRIP, headcount: 4, openQuestions: [], runId: started.value.status === "started" ? started.value.run.id : "" });
      const results = await Promise.all([save(), save(), save()]);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.map((r) => (r.ok ? r.value.version : 0)).sort()).toEqual([1, 2, 3]);
    }, 60_000);

    it("saves constraints for the people named and leaves everyone else's alone", async () => {
      const { people } = await newGroup();
      const [ana, ben] = [people[1].id, people[2].id];
      await constraintRepo.save({ [ana]: { ownRoom: true }, [ben]: { budgetCap: { amountMinor: 35000, currency: "USD" } } });
      await constraintRepo.save({ [ana]: { ownRoom: false } });
      await constraintRepo.save({});
      expect(await constraintRepo.forMembers([ana, ben, people[3].id])).toEqual({ [ana]: { ownRoom: false }, [ben]: { budgetCap: { amountMinor: 35000, currency: "USD" } } });
      expect(await constraintRepo.forMembers([])).toEqual({});
      const rows = await handle.db.select().from(memberConstraints).where(inArray(memberConstraints.memberId, [ana, ben]));
      expect(rows).toHaveLength(2);
    }, 60_000);
  });

  describe("searches and plans", () => {
    async function brief(groupId: string, memberId: string) {
      const message = await say(groupId, memberId, "@trippy plan");
      const started = await runRepo.start({ groupId, triggerMessageId: message.id, requestedByMemberId: null, now: new Date(), staleAfterMs: 300_000 });
      if (!started.ok || started.value.status !== "started") throw new Error("expected a started run");
      const saved = await briefRepo.save({ groupId, fields: TRIP, headcount: 4, openQuestions: [], runId: started.value.run.id });
      if (!saved.ok) throw new Error(saved.error.message);
      return saved.value;
    }

    it("keeps every search and every offer, once each, and says which search found which offer", async () => {
      const { groupId, people } = await newGroup();
      const stored = await brief(groupId, people[0].id);
      const many: Offer[] = Array.from({ length: 250 }, (_, i) => ({ ...flight4, id: `bulk-${i}`, listingId: `bulk-listing-${i}` }));
      const searches = [
        { query: { kind: "flight" as const, city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4 }, offers: many },
        { query: { kind: "hotel" as const, city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 3 }, offers: [triple, many[0]] },
      ];
      const saved = await searchStore.save(stored.id, searches, NOW);
      if (!saved.ok) throw new Error(saved.error.message);

      expect(saved.value.size).toBe(251);
      expect(saved.value.get("bulk-0")).toBe(saved.value.get("bulk-249"));
      expect(saved.value.get("bulk-0")).not.toBe(saved.value.get("fx-htl-triple"));
      const searchRows = await handle.db.select().from(offerSearches).where(eq(offerSearches.briefId, stored.id));
      expect(searchRows.map((r) => r.guests).sort()).toEqual([3, 4]);
      const offerRows = await handle.db.select().from(offersTable).where(inArray(offersTable.searchId, searchRows.map((r) => r.id)));
      expect(offerRows).toHaveLength(251);
      expect(offerRows.find((r) => r.offerId === "fx-htl-triple")).toMatchObject({ listingId: "riverside-hotel-triple", kind: "hotel" });
    }, 90_000);

    it("creates a plan with its people, picks and suggestions together, and finds it again as the group's latest", async () => {
      const { groupId, people } = await newGroup();
      const stored = await brief(groupId, people[0].id);
      expect(await planStore.latest(groupId)).toBeNull();

      const created = await planStore.create({
        groupId, briefId: stored.id, title: "Bangkok weekend", summary: null, deadlineAt: new Date(NOW.getTime() + 540_000), hardDeadlineAt: new Date(NOW.getTime() + 172_800_000),
        baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, inputsHash: "hash-1", offersCheckedAt: NOW, recreatedFromPlanId: null,
        memberIds: people.map((p) => p.id),
        picks: [{ offer: flight4, searchId: null, memberIds: people.map((p) => p.id), reason: "Only evening flight", notes: { [people[1].id]: "after 18:00" } }, { offer: single, searchId: null, memberIds: [people[3].id], reason: "Own room", notes: {} }],
        suggestions: [],
      });
      if (!created.ok) throw new Error(created.error.message);

      expect(await planStore.latest(groupId)).toEqual({ id: created.value, title: "Bangkok weekend", status: "draft", inputsHash: "hash-1", headcount: 4, agreedCount: 0 });
      expect(await handle.db.select().from(planMembers).where(eq(planMembers.planId, created.value))).toHaveLength(4);
      const picks = await handle.db.select().from(planPicks).where(eq(planPicks.planId, created.value));
      expect(picks.map((p) => p.position).sort()).toEqual([0, 1]);
      expect(picks.find((p) => p.position === 0)).toMatchObject({ listingId: flight4.listingId, reason: "Only evening flight" });
    }, 60_000);

    it("lists every plan of the group with its own state, oldest first, and which plan replaced it", async () => {
      const { groupId, people } = await newGroup();
      const stored = await brief(groupId, people[0].id);
      const base = { groupId, briefId: stored.id, summary: null, deadlineAt: new Date(NOW.getTime() + 540_000), hardDeadlineAt: new Date(NOW.getTime() + 172_800_000), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, inputsHash: "h", offersCheckedAt: NOW, memberIds: people.map((p) => p.id), picks: [], suggestions: [] };
      const first = await planStore.create({ ...base, title: "First", recreatedFromPlanId: null });
      if (!first.ok) throw new Error(first.error.message);
      await handle.db.update(plans).set({ status: "captured" }).where(eq(plans.id, first.value));
      await handle.db.update(planMembers).set({ planAgreement: "agreed" }).where(eq(planMembers.planId, first.value));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await planStore.create({ ...base, title: "Second", recreatedFromPlanId: null });
      if (!second.ok) throw new Error(second.error.message);
      await planStore.markReplaced(second.value, first.value);

      const cards = await planStore.cards(groupId);
      expect(cards.map((card) => card.title)).toEqual(["First", "Second"]);
      expect(cards[0]).toEqual({ id: first.value, title: "First", status: "captured", headcount: 4, agreedCount: 4, replacedById: null });
      expect(cards[1]).toMatchObject({ id: second.value, status: "draft", agreedCount: 0, replacedById: first.value });
      expect(await planStore.cards((await newGroup()).groupId)).toEqual([]);
    }, 60_000);

    it("lists the dates of trips that are being booked or paid for, in this group only", async () => {
      const { groupId, people } = await newGroup();
      const other = await newGroup(["Zed"]);
      const stored = await brief(groupId, people[0].id);
      const otherStored = await brief(other.groupId, other.people[0].id);
      const base = { briefId: stored.id, summary: null, deadlineAt: new Date(NOW.getTime() + 540_000), hardDeadlineAt: new Date(NOW.getTime() + 172_800_000), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, inputsHash: "h", offersCheckedAt: NOW, recreatedFromPlanId: null, picks: [], suggestions: [] };
      const make = async (title: string, status: "draft" | "booking" | "captured" | "expired") => {
        const made = await planStore.create({ ...base, groupId, title, memberIds: people.map((p) => p.id) });
        if (!made.ok) throw new Error(made.error.message);
        await handle.db.update(plans).set({ status }).where(eq(plans.id, made.value));
        return made.value;
      };
      const paid = await make("Paid trip", "captured");
      const booking = await make("Booking trip", "booking");
      await make("Still a draft", "draft");
      await make("Ended", "expired");
      const otherMade = await planStore.create({ ...base, briefId: otherStored.id, groupId: other.groupId, title: "Someone else's", memberIds: other.people.map((p) => p.id) });
      if (!otherMade.ok) throw new Error(otherMade.error.message);
      await handle.db.update(plans).set({ status: "captured" }).where(eq(plans.id, otherMade.value));

      const trips = await planStore.committedTrips(groupId);
      expect(trips.map((t) => t.planId).sort()).toEqual([paid, booking].sort());
      expect(trips.find((t) => t.planId === paid)).toMatchObject({ title: "Paid trip", departDate: TRIP.departDate, returnDate: TRIP.returnDate });
    }, 60_000);

    it("lets a plan be replaced only once, even if two replacements are saved at the same moment", async () => {
      const { groupId, people } = await newGroup();
      const stored = await brief(groupId, people[0].id);
      const base = { groupId, briefId: stored.id, title: "t", summary: null, deadlineAt: new Date(NOW.getTime() + 540_000), hardDeadlineAt: new Date(NOW.getTime() + 172_800_000), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, inputsHash: "h", offersCheckedAt: NOW, memberIds: people.map((p) => p.id), picks: [], suggestions: [] };
      const original = await planStore.create({ ...base, recreatedFromPlanId: null });
      if (!original.ok) throw new Error(original.error.message);

      const results = await Promise.all([planStore.create({ ...base, recreatedFromPlanId: original.value }), planStore.create({ ...base, recreatedFromPlanId: original.value })]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error.code === "conflict")).toHaveLength(1);
    }, 60_000);

    it("removes a plan completely, leaving the chat message that pointed at it without a link", async () => {
      const { groupId, people } = await newGroup();
      const stored = await brief(groupId, people[0].id);
      const created = await planStore.create({ groupId, briefId: stored.id, title: "t", summary: null, deadlineAt: new Date(NOW.getTime() + 540_000), hardDeadlineAt: new Date(NOW.getTime() + 172_800_000), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, inputsHash: "h", offersCheckedAt: NOW, recreatedFromPlanId: null, memberIds: people.map((p) => p.id), picks: [{ offer: flight4, searchId: null, memberIds: [people[0].id], reason: "r", notes: {} }], suggestions: [] });
      if (!created.ok) throw new Error(created.error.message);
      const announced = await messageRepo.postAgent(groupId, "Here is a plan", { planId: created.value });
      if (!announced.ok) throw new Error(announced.error.message);

      await planStore.remove(created.value);
      expect(await planStore.latest(groupId)).toBeNull();
      expect(await handle.db.select().from(planMembers).where(eq(planMembers.planId, created.value))).toEqual([]);
      expect(await handle.db.select().from(planPicks).where(eq(planPicks.planId, created.value))).toEqual([]);
      const [message] = await handle.db.select().from(messages).where(eq(messages.id, announced.value.id));
      expect(message.planId).toBeNull();
    }, 60_000);
  });

  describe("the whole agent run", () => {
    /** What the model does on each turn of the next run. */
    let steps: ChatStep[] = [];
    const script = (...next: ChatStep[]): void => { steps = next; };
    const FIVE_PEOPLE_IDS = ["a", "b", "c", "d", "e"];

    function depsFor(source: FakeOfferSource): { deps: AgentDeps; planners: RecordingPlanner[] } {
      const planners: RecordingPlanner[] = [];
      const deps: AgentDeps = {
        groups: groupRepo, messages: messageRepo, runs: runRepo, briefs: briefRepo, constraints: constraintRepo, searches: searchStore, plans: planStore, planRepository: planRepo,
        offers: source, venues: null, fx: new StaticFxRates(), clock: () => NOW,
        makePlanner: (meter) => { const planner = new RecordingPlanner(behaviour, meter); planners.push(planner); return planner; },
        makeChatModel: (meter) => new ScriptedChatModel(steps, meter),
      };
      return { deps, planners };
    }

    async function callAgent(deps: AgentDeps, groupId: string, memberId: string, text: string) {
      const message = await say(groupId, memberId, text);
      expect(message.mentionsAgent).toBe(true);
      const started = await startAgentRun(deps, { id: message.id, groupId, memberId });
      if (started.ok && started.value.status === "started") await runAgent(deps, started.value.run);
      return started;
    }

    const agentReply = async (groupId: string) => (await messageRepo.recent(groupId, 1))[0];

    it("takes a chat to a saved plan, then fits a friend in by replacing it, all in the database", async () => {
      const { groupId, joinToken, people } = await newGroup();
      await say(groupId, people[1].id, "I can only fly after 6pm on Friday");
      await say(groupId, people[2].id, "Max $350 for me");
      await say(groupId, people[3].id, "I'd like my own room. Not into cooking classes");
      const source = new FakeOfferSource();
      const { deps } = depsFor(source);

      // 1. The first call makes a plan for four.
      script(...planTurns("Found a Bangkok plan for the four of you: $1,340.00 total (sandbox price)."));
      await callAgent(deps, groupId, people[0].id, "@trippy plan Bangkok, leaving Fri 11 Dec and back Sun 13 Dec, from Singapore");
      const first = await planStore.latest(groupId);
      if (!first) throw new Error("expected a plan");
      expect(first).toMatchObject({ status: "reviewing", headcount: 4, agreedCount: 0 });
      const announcement = await agentReply(groupId);
      expect(announcement).toMatchObject({ kind: "agent", planId: first.id });
      expect(announcement.body).toContain("Found a Bangkok plan for the four of you");
      expect(await handle.db.select().from(planPicks).where(eq(planPicks.planId, first.id))).toHaveLength(3);
      expect((await handle.db.select().from(offersTable).innerJoin(offerSearches, eq(offerSearches.id, offersTable.searchId)).innerJoin(tripBriefs, eq(tripBriefs.id, offerSearches.briefId)).where(eq(tripBriefs.groupId, groupId))).length).toBeGreaterThan(0);
      const [run] = await handle.db.select().from(agentRuns).where(and(eq(agentRuns.groupId, groupId), eq(agentRuns.status, "done")));
      // three turns of the model and the reading of everyone's limits
      expect(run).toMatchObject({ promptTokens: 40, completionTokens: 80, reasoningTokens: 20 });

      // 2. Calling again with nothing changed leaves the plan alone.
      script(search(), (request) => proposeFrom(request), says("Nothing has changed, the plan stands."));
      await callAgent(deps, groupId, people[1].id, "@trippy status?");
      expect((await agentReply(groupId)).body).toContain("the plan stands");
      expect((await planStore.latest(groupId))?.id).toBe(first.id);

      // 3. Someone agrees to the plan, then a friend joins and is fitted in.
      const agreed = await handle.db.update(planMembers).set({ planAgreement: "agreed", agreedShareMinor: 32000 }).where(and(eq(planMembers.planId, first.id), eq(planMembers.memberId, people[0].id))).returning();
      expect(agreed).toHaveLength(1);

      const ravi = await groupRepo.joinWithLink(joinToken, { displayName: "Ravi", currency: "USD" });
      if (!ravi.ok) throw new Error(ravi.error.message);
      source.offers = OFFERS_FOR_FIVE;
      script(search(), (request) => proposeFrom(request, FIVE_PEOPLE_IDS), says("Ravi is in! Updated the plan for five."));
      await callAgent(deps, groupId, people[1].id, "@trippy Ravi joined, please fit him in");

      const second = await planStore.latest(groupId);
      if (!second) throw new Error("expected a second plan");
      expect(second.id).not.toBe(first.id);
      expect(second).toMatchObject({ status: "reviewing", headcount: 5, agreedCount: 0 });
      const [oldRow] = await handle.db.select().from(plans).where(eq(plans.id, first.id));
      expect(oldRow).toMatchObject({ status: "expired", replacedByPlanId: second.id });
      const [newRow] = await handle.db.select().from(plans).where(eq(plans.id, second.id));
      expect(newRow.recreatedFromPlanId).toBe(first.id);
      expect(await handle.db.select().from(planMembers).where(eq(planMembers.planId, second.id))).toHaveLength(5);
      const updated = await agentReply(groupId);
      expect(updated.body).toContain("Ravi is in!");
      expect(updated.planId).toBe(second.id);
    }, 180_000);

    it("keeps the plan when booking has already started and a friend asks to be added", async () => {
      const { groupId, joinToken, people } = await newGroup();
      await say(groupId, people[1].id, "I can only fly after 6pm on Friday");
      const source = new FakeOfferSource();
      const { deps } = depsFor(source);
      script(...planTurns("Plan is up."));
      await callAgent(deps, groupId, people[0].id, "@trippy plan Bangkok, leaving Fri 11 Dec and back Sun 13 Dec, from Singapore");
      const plan = await planStore.latest(groupId);
      if (!plan) throw new Error("expected a plan");
      await handle.db.update(plans).set({ status: "booking" }).where(eq(plans.id, plan.id));

      await groupRepo.joinWithLink(joinToken, { displayName: "Ravi", currency: "USD" });
      source.offers = OFFERS_FOR_FIVE;
      script(search(), (request) => proposeFrom(request, FIVE_PEOPLE_IDS), says("Booking has already started, so the plan cannot change."));
      await callAgent(deps, groupId, people[1].id, "@trippy fit Ravi in");

      expect((await agentReply(groupId)).body).toContain("Booking has already started");
      expect(await handle.db.select().from(plans).where(eq(plans.groupId, groupId))).toHaveLength(1);
      expect((await planStore.latest(groupId))?.status).toBe("booking");
    }, 180_000);

    it("answers two people mentioning it at the same moment with one run and one 'still working'", async () => {
      const { groupId, people } = await newGroup();
      const source = new FakeOfferSource();
      const { deps } = depsFor(source);
      const [a, b] = await Promise.all([say(groupId, people[0].id, "@trippy plan Bangkok, 11 to 13 Dec, from Singapore"), say(groupId, people[1].id, "@trippy hello?")]);
      const results = await Promise.all([startAgentRun(deps, { id: a.id, groupId, memberId: people[0].id }), startAgentRun(deps, { id: b.id, groupId, memberId: people[1].id })]);
      const statuses = results.map((r) => (r.ok ? r.value.status : "error")).sort();
      expect(statuses).toEqual(["busy", "started"]);
      const busyReply = (await messageRepo.recent(groupId, 10)).find((m) => m.kind === "agent");
      expect(busyReply?.body).toContain("still working");
      expect([a.id, b.id]).toContain(busyReply?.replyToMessageId);

      const winner = results.find((r) => r.ok && r.value.status === "started");
      if (winner?.ok && winner.value.status === "started") await runAgent(deps, winner.value.run);
      expect(createUsageMeter().totals().calls).toBe(0);
    }, 120_000);

    it("never stores a made-up run id: the run closes even when nothing can be planned", async () => {
      const { groupId, people } = await newGroup();
      const { deps } = depsFor(new FakeOfferSource());
      const message = await say(groupId, people[0].id, `@trippy ${randomUUID().slice(0, 8)} where?`);
      const started = await startAgentRun(deps, { id: message.id, groupId, memberId: people[0].id });
      if (started.ok && started.value.status === "started") await runAgent(deps, started.value.run);
      const rows = await handle.db.select().from(agentRuns).where(eq(agentRuns.groupId, groupId));
      expect(rows).toHaveLength(1);
      expect(rows[0].finishedAt).not.toBeNull();
    }, 120_000);
  });
});

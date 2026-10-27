import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { FlightOffer, HotelOffer } from "@/domain/offers/schema";
import { BANGKOK_OFFERS, pick } from "@/domain/planner/test-support";
import { runAgent, startAgentRun } from "./run-agent";
import { BANGKOK_TRIP, PLAN_FOR_FOUR, aliasOf, buildWorld, member, planAs, type PlannerBehaviour, type World } from "./test-support";

const FOUR = ["nevin", "ana", "ben", "jia"];
const FIVE = [...FOUR, "ravi"];

const flight4 = BANGKOK_OFFERS.find((o): o is FlightOffer => o.id === "fx-flt-evening") as FlightOffer;
const triple = BANGKOK_OFFERS.find((o): o is HotelOffer => o.id === "fx-htl-triple") as HotelOffer;
const single = BANGKOK_OFFERS.find((o): o is HotelOffer => o.id === "fx-htl-single") as HotelOffer;
/** The same trip priced for five: one flight for all five, a triple, and a single each for Jia and Ravi. */
const OFFERS_FOR_FIVE = [
  { ...flight4, id: "flt-5", listingId: "flt-5", guests: 5, totalMinor: 90000 },
  triple,
  single,
  { ...single, id: "fx-htl-single-ravi", listingId: "single-ravi" },
];
const PLAN_FOR_FIVE = {
  title: "Bangkok weekend",
  picks: [pick("flt-5", FIVE), pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single", ["jia"]), pick("fx-htl-single-ravi", ["ravi"])],
};

/** What the model does for four people, and for five when the group has grown. */
const byHeadcount: PlannerBehaviour = {
  plan: (input) => ok(input.memberIds.length === 5 ? planAs(PLAN_FOR_FIVE, FIVE) : planAs(PLAN_FOR_FOUR, FOUR)),
};

const chat = (world: World) => {
  world.messages.human("nevin", "@agent plan Bangkok, leaving Fri 11 Dec and back Sun 13 Dec, flying from Singapore");
  world.messages.human("ana", "I can only fly after 6pm on Friday");
  world.messages.human("ben", "Max $350 for me");
  world.messages.human("jia", "I'd like my own room. Not into cooking classes");
};

/** Someone mentions the agent, and the run it starts is carried out. */
async function callAgent(world: World, memberId = "nevin", text = "@agent plan it") {
  const message = world.messages.human(memberId, text);
  const started = await startAgentRun(world.deps, { id: message.id, groupId: message.groupId, memberId });
  if (started.ok && started.value.status === "started") await runAgent(world.deps, started.value.run);
  return started;
}

describe("a complete chat", () => {
  it("makes a plan, saves it for review, and announces it with real numbers", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);

    expect(world.plans.records).toHaveLength(1);
    expect(world.plans.statusOf("plan-1")).toBe("reviewing");
    const announcement = world.messages.agentMessages.at(-1);
    expect(announcement?.planId).toBe("plan-1");
    expect(announcement?.body).toContain("Here is a plan for Bangkok, Fri 11 Dec to Sun 13 Dec, for 4 people");
    expect(announcement?.body).toContain("$1,340.00");
    for (const line of ["Nevin: $320.00", "Ana: $320.00", "Ben: $320.00", "Jia: $380.00"]) expect(announcement?.body).toContain(line);
    expect(announcement?.body).not.toContain("Not fully served");
    expect(announcement?.body).toContain("Nothing is charged until everyone has agreed");
  });

  it("remembers what it learned: the brief, each person's constraints, every search, and what the plan was built from", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);

    expect(world.briefs.versions).toHaveLength(1);
    expect(world.briefs.versions[0]).toMatchObject({ headcount: 4, fields: BANGKOK_TRIP });
    expect([...world.constraints.stored.keys()].sort()).toEqual(["ana", "ben", "jia"]);
    expect(world.searches.saved[0].searches.map((s) => s.query.kind)).toEqual(["flight", "hotel", "hotel", "hotel", "hotel"]);

    const plan = world.plans.records[0].input;
    expect(plan.headcount).toBe(4);
    expect(plan.memberIds).toEqual(FOUR);
    expect(plan.picks).toHaveLength(3);
    expect(plan.picks.every((p) => p.searchId !== null)).toBe(true);
    expect(plan.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.recreatedFromPlanId).toBeNull();
  });

  it("closes the run as done, with what the model calls cost", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    expect(world.runs.finished).toHaveLength(1);
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "done", usage: { calls: 3, promptTokens: 30, completionTokens: 60, reasoningTokens: 15 } });
  });

  it("searches for the whole group: one flight for four, and hotels for each room size", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    expect(world.source.queries.map((q) => `${q.kind}:${q.guests}`)).toEqual(["flight:4", "hotel:1", "hotel:2", "hotel:3", "hotel:4"]);
  });

  it("reports who is not fully served, by name", async () => {
    const world = buildWorld({ plan: () => ok(planAs({ title: "x", picks: [pick("fx-flt-early", FOUR), pick("fx-htl-triple", ["nevin", "ana", "ben"]), pick("fx-htl-single", ["jia"])] }, FOUR)) });
    chat(world);
    await callAgent(world);
    const body = world.messages.lastAgentBody;
    expect(body).toContain("Not fully served");
    expect(body).toContain("Ana wants the outbound flight after 18:00");
    expect(body).not.toContain("ana wants");
  });
});

describe("what the model is shown", () => {
  it("never sees a real member id, only stand-ins, in anything it is asked or told", async () => {
    const world = buildWorld(byHeadcount);
    chat(world);
    await callAgent(world);
    const planner = world.planner();
    const ids = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "memberId") ids.add(String(item)); collect(item); }
    };
    [planner.briefCalls, planner.constraintCalls, planner.planCalls, planner.suggestCalls].forEach(collect);
    expect([...ids].sort()).toEqual(["m1", "m2", "m3", "m4"]);
    for (const call of planner.planCalls) {
      expect(call.memberIds).toEqual(["m1", "m2", "m3", "m4"]);
      expect(Object.keys(call.constraints).every((key) => /^m\d$/.test(key))).toBe(true);
    }
  });

  it("is shown only what people said, never the agent's own earlier messages", async () => {
    const world = buildWorld();
    chat(world);
    await world.messages.postAgent("g1", "Earlier agent text that must not be fed back");
    await world.messages.postSystem("g1", "Someone joined");
    await callAgent(world);
    const sent = world.planner().briefCalls[0].messages;
    expect(sent.some((m) => m.text.includes("Earlier agent text"))).toBe(false);
    expect(sent.some((m) => m.text.includes("Someone joined"))).toBe(false);
    expect(sent.length).toBeGreaterThanOrEqual(4);
  });

  it("is told what was already settled, so a later message changes only what it mentions", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    await callAgent(world, "ana", "@agent anything new?");
    expect(world.planners[1].briefCalls[0].previous).toMatchObject(BANGKOK_TRIP);
  });
});

describe("when the trip is not clear yet", () => {
  const vague: PlannerBehaviour = { brief: () => ok({ fields: {}, questions: ["Where would you like to go?", "When are you thinking of travelling?"] }) };

  it("asks the group's questions, and searches for nothing", async () => {
    const world = buildWorld(vague);
    world.messages.human("nevin", "@agent let's go somewhere warm soon");
    await callAgent(world, "ana", "@agent please");

    expect(world.messages.lastAgentBody).toContain("I need a bit more information before I can plan:");
    expect(world.messages.lastAgentBody).toContain("1. Where would you like to go?");
    expect(world.messages.lastAgentBody).toContain("2. When are you thinking of travelling?");
    expect(world.source.queries).toEqual([]);
    expect(world.plans.records).toEqual([]);
    expect(world.runs.finished[0].outcome.status).toBe("done");
  });

  it("keeps the questions with the brief so they can be shown again", async () => {
    const world = buildWorld(vague);
    await callAgent(world);
    expect(world.briefs.versions[0].openQuestions).toEqual(["Where would you like to go?", "When are you thinking of travelling?"]);
    expect(world.briefs.versions[0].fields).toEqual({ destinationCity: undefined, destinationCountry: undefined, destinationAirport: undefined, originAirport: undefined, departDate: undefined, returnDate: undefined });
  });

  it("asks for itself when the model asked nothing but something is missing", async () => {
    const world = buildWorld({ brief: () => ok({ fields: { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK", originAirport: "SIN" }, questions: [] }) });
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("What dates would you like to travel");
    expect(world.plans.records).toEqual([]);
  });

  it("asks about dates that have already passed, even if the model did not", async () => {
    const world = buildWorld({ brief: () => ok({ fields: { ...BANGKOK_TRIP, departDate: "2026-01-02", returnDate: "2026-01-04" }, questions: [] }) });
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("has already passed");
    expect(world.source.queries).toEqual([]);
  });

  it("then makes the plan once the group has answered", async () => {
    let answered = false;
    const world = buildWorld({ brief: () => (answered ? ok({ fields: BANGKOK_TRIP, questions: [] }) : ok({ fields: { destinationCity: "Bangkok", destinationCountry: "TH", destinationAirport: "BKK" }, questions: ["Which dates, and where do you fly from?"] })) });
    chat(world);
    await callAgent(world);
    expect(world.plans.records).toEqual([]);

    answered = true;
    await callAgent(world, "nevin", "the 11th to the 13th, from Singapore");
    expect(world.plans.records).toHaveLength(1);
    expect(world.briefs.versions).toHaveLength(2);
  });
});

describe("calling the agent again", () => {
  it("says the plan stands when nothing has changed, and does not search or replan", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    const searchesBefore = world.source.queries.length;

    await callAgent(world, "ben", "@agent what's the status?");
    expect(world.messages.lastAgentBody).toContain("Nothing has changed since I made the plan");
    expect(world.messages.lastAgentBody).toContain("0 of 4 have agreed");
    expect(world.plans.records).toHaveLength(1);
    expect(world.source.queries.length).toBe(searchesBefore);
    expect(world.planners[1].planCalls).toEqual([]);
  });

  it("keeps everyone's agreements when it only says the plan stands", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    const record = world.plans.records[0];
    record.snapshot = { ...record.snapshot, members: record.snapshot.members.map((m, i) => (i < 2 ? { ...m, planAgreement: "agreed", agreedShareMinor: 100 } : m)) };

    await callAgent(world, "ben", "@agent status?");
    expect(world.messages.lastAgentBody).toContain("2 of 4 have agreed");
    expect(world.plans.statusOf("plan-1")).toBe("reviewing");
    expect(world.plans.records[0].snapshot.members.filter((m) => m.planAgreement === "agreed")).toHaveLength(2);
  });

  it("makes a new plan when someone's constraint changed", async () => {
    let jiaBudget = false;
    const world = buildWorld({ constraints: (input) => ok({ ...JSON.parse(JSON.stringify(input.memberIds.includes("m4") ? { m2: { outboundDeparture: { after: "18:00" } }, m3: { budgetCap: { amountMinor: 35000, currency: "USD" } }, m4: { ownRoom: true, ...(jiaBudget ? { budgetCap: { amountMinor: 50000, currency: "USD" } } : {}), skipActivityCategories: ["cooking"] } } : {})) }) });
    chat(world);
    await callAgent(world);
    jiaBudget = true;
    await callAgent(world, "jia", "@agent my budget is 500 now");
    expect(world.plans.records).toHaveLength(2);
    expect(world.plans.statusOf("plan-1")).toBe("expired");
    expect(world.plans.records[1].input.recreatedFromPlanId).toBe("plan-1");
  });

  it("makes a new plan when the old one has ended, even if nothing else changed", async () => {
    const world = buildWorld();
    chat(world);
    await callAgent(world);
    world.plans.force("plan-1", "expired");
    await callAgent(world, "ana", "@agent again please");
    expect(world.plans.records).toHaveLength(2);
    expect(world.plans.records[1].input.recreatedFromPlanId).toBeNull();
    expect(world.messages.lastAgentBody).toContain("Here is a plan");
    expect(world.messages.lastAgentBody).not.toContain("updated plan");
  });
});

describe("a friend joins", () => {
  async function groupOfFourWithAPlan() {
    const world = buildWorld(byHeadcount);
    chat(world);
    await callAgent(world);
    return world;
  }

  it("fits them in: a new plan for five replaces the old one, and everyone must look again", async () => {
    const world = await groupOfFourWithAPlan();
    world.groups.members = [...world.groups.members, member("ravi")];
    world.source.offers = OFFERS_FOR_FIVE;
    await callAgent(world, "ana", "@agent Ravi joined, please fit him in");

    expect(world.plans.records).toHaveLength(2);
    expect(world.plans.statusOf("plan-1")).toBe("expired");
    expect(world.plans.records[0].replacedBy).toBe("plan-2");
    expect(world.plans.statusOf("plan-2")).toBe("reviewing");
    expect(world.plans.records[1].input).toMatchObject({ headcount: 5, recreatedFromPlanId: "plan-1" });
    expect(world.plans.records[1].input.memberIds).toEqual(FIVE);
    expect(world.plans.records[1].snapshot.members.every((m) => m.planAgreement === "pending")).toBe(true);

    const body = world.messages.lastAgentBody;
    expect(body).toContain("Here is an updated plan for Bangkok");
    expect(body).toContain("for 5 people");
    expect(body).toContain("Ravi:");
    expect(body).toContain("The earlier plan is cancelled");
    expect(world.messages.agentMessages.at(-1)?.planId).toBe("plan-2");
  });

  it("searches again for five, because the old offers were priced for four", async () => {
    const world = await groupOfFourWithAPlan();
    world.groups.members = [...world.groups.members, member("ravi")];
    world.source.offers = OFFERS_FOR_FIVE;
    world.source.queries.length = 0;
    await callAgent(world, "ana", "@agent fit Ravi in");
    expect(world.source.queries[0]).toMatchObject({ kind: "flight", guests: 5 });
    expect(world.briefs.versions.at(-1)?.headcount).toBe(5);
  });

  it("keeps the old plan and says why when booking has already started", async () => {
    const world = await groupOfFourWithAPlan();
    world.plans.force("plan-1", "booking");
    world.groups.members = [...world.groups.members, member("ravi")];
    world.source.offers = OFFERS_FOR_FIVE;
    world.source.queries.length = 0;
    await callAgent(world, "ana", "@agent fit Ravi in");

    expect(world.messages.lastAgentBody).toContain("Booking has already started");
    expect(world.plans.records).toHaveLength(1);
    expect(world.plans.statusOf("plan-1")).toBe("booking");
    expect(world.source.queries).toEqual([]);
  });

  it("keeps the old plan when booking starts in the middle of building the new one", async () => {
    const world = await groupOfFourWithAPlan();
    world.groups.members = [...world.groups.members, member("ravi")];
    world.source.offers = OFFERS_FOR_FIVE;
    // The group's view still says "held", but the plan has moved on to booking by the time it is swapped.
    world.plans.force("plan-1", "booking");
    world.plans.summaryStatusOverride = "held";
    await callAgent(world, "ana", "@agent fit Ravi in");

    expect(world.messages.lastAgentBody).toContain("Booking has already started");
    expect(world.plans.records).toHaveLength(1);
    expect(world.plans.statusOf("plan-1")).toBe("booking");
    expect(world.runs.finished.at(-1)?.outcome).toMatchObject({ status: "failed", errorCode: "replace_refused" });
  });

  it("says the trip is booked when it is already done", async () => {
    const world = await groupOfFourWithAPlan();
    world.plans.force("plan-1", "captured");
    world.groups.members = [...world.groups.members, member("ravi")];
    await callAgent(world, "ana", "@agent fit Ravi in");
    expect(world.messages.lastAgentBody).toContain("already booked");
    expect(world.plans.records).toHaveLength(1);
  });
});

describe("when something goes wrong", () => {
  it("tells the group, and closes the run as failed, when the model cannot be reached", async () => {
    const world = buildWorld({ brief: () => err({ code: "planner_unavailable", message: "Muse is rate limiting requests: secret detail" }) });
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("could not reach my assistant");
    expect(world.messages.lastAgentBody).not.toContain("secret detail");
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "planner_unavailable" });
    expect(world.plans.records).toEqual([]);
  });

  it("asks to be told again when the model's answer made no sense", async () => {
    const world = buildWorld({ brief: () => err({ code: "invalid_output", message: "not JSON" }) });
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("could not make sense");
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "invalid_output" });
  });

  it("carries on with what it already knows when only the constraints could not be read", async () => {
    const world = buildWorld({ constraints: () => err({ code: "invalid_output", message: "bad" }) });
    chat(world);
    await callAgent(world);
    expect(world.plans.records).toHaveLength(1);
  });

  it("stops when the model is down while reading constraints", async () => {
    const world = buildWorld({ constraints: () => err({ code: "planner_unavailable", message: "down" }) });
    chat(world);
    await callAgent(world);
    expect(world.plans.records).toEqual([]);
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "planner_unavailable" });
  });

  it("tells the group when the travel search is down", async () => {
    const world = buildWorld();
    world.source.failWith = { code: "source_unavailable", message: "liteAPI is down" };
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("could not search for flights and hotels");
    expect(world.messages.lastAgentBody).not.toContain("liteAPI");
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "search_unavailable" });
  });

  it("says the flight prices could not be fetched, and does not ask the model to plan without flights", async () => {
    const world = buildWorld();
    world.source.failKinds.add("flight");
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("I could not get flight prices just now");
    expect(world.planner().planCalls).toEqual([]);
    expect(world.plans.records).toEqual([]);
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "search_incomplete" });
  });

  it("says the hotel prices could not be fetched when only the hotel searches fail", async () => {
    const world = buildWorld();
    world.source.failKinds.add("hotel");
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("I could not get hotel prices just now");
    expect(world.planner().planCalls).toEqual([]);
  });

  it("says nothing was found, in plain words, when the search worked but there were no flights", async () => {
    const world = buildWorld();
    world.source.offers = BANGKOK_OFFERS.filter((o) => o.kind === "hotel");
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("I found no flight for those dates and that group size");
    expect(world.messages.lastAgentBody).not.toContain("could not get");
    expect(world.planner().planCalls).toEqual([]);
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "nothing_found" });
  });

  it("names both kinds when neither a flight nor a hotel was found", async () => {
    const world = buildWorld();
    world.source.offers = [];
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("I found no flight and hotel");
  });

  it("says so when no plan works with what is available", async () => {
    const world = buildWorld({ plan: () => ok({ title: "x", picks: [pick("not-an-offer", ["m1"])] }) });
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("could not find a plan that works");
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "no_valid_plan" });
    expect(world.plans.records).toEqual([]);
  });

  it("asks the model again with what was wrong before giving up on a plan", async () => {
    const world = buildWorld({ plan: () => ok({ title: "x", picks: [pick("not-an-offer", ["m1"])] }) });
    chat(world);
    await callAgent(world);
    expect(world.planner().planCalls.length).toBe(3);
    expect(world.planner().planCalls[1].feedback.length).toBeGreaterThan(0);
  });

  it("will not price a group when it has no exchange rate for someone's currency", async () => {
    const world = buildWorld({}, [member("nevin"), member("ana", "SGD"), member("ben"), member("jia")]);
    chat(world);
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("no exchange rate");
    expect(world.source.queries).toEqual([]);
  });

  it("closes the run and tells the group even when something unexpected breaks", async () => {
    const world = buildWorld();
    chat(world);
    world.deps.briefs.latest = async () => { throw new Error("database exploded: password=hunter2"); };
    await callAgent(world);
    expect(world.messages.lastAgentBody).toContain("Something went wrong on my side");
    expect(world.messages.lastAgentBody).not.toContain("hunter2");
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "unexpected" });
    expect(world.runs.running).toBeNull();
  });

  it("does not start a run for a group that has no one in it", async () => {
    const world = buildWorld({}, []);
    await callAgent(world);
    expect(world.runs.finished[0].outcome).toMatchObject({ status: "failed", errorCode: "no_members" });
  });
});

describe("starting a run", () => {
  it("tells the person when a run is already going, and starts no second one", async () => {
    const world = buildWorld();
    const first = world.messages.human("nevin", "@agent plan it");
    const started = await startAgentRun(world.deps, { id: first.id, groupId: "g1", memberId: "nevin" });
    expect(started.ok && started.value.status).toBe("started");

    const second = world.messages.human("ana", "@agent hello?");
    const busy = await startAgentRun(world.deps, { id: second.id, groupId: "g1", memberId: "ana" });
    expect(busy.ok && busy.value.status).toBe("busy");
    expect(world.messages.lastAgentBody).toContain("still working on the last request");
    expect(world.messages.agentMessages.at(-1)?.replyToMessageId).toBe(second.id);
    expect(world.runs.started).toHaveLength(1);
  });

  it("handles each message once", async () => {
    const world = buildWorld();
    const message = world.messages.human("nevin", "@agent plan it");
    await startAgentRun(world.deps, { id: message.id, groupId: "g1", memberId: "nevin" });
    world.runs.running = null;
    const again = await startAgentRun(world.deps, { id: message.id, groupId: "g1", memberId: "nevin" });
    expect(again.ok && again.value.status).toBe("duplicate");
    expect(world.messages.agentMessages).toEqual([]);
  });

  it("replies to the message that called it", async () => {
    const world = buildWorld();
    chat(world);
    const message = world.messages.human("nevin", "@agent go");
    const started = await startAgentRun(world.deps, { id: message.id, groupId: "g1", memberId: "nevin" });
    if (started.ok && started.value.status === "started") await runAgent(world.deps, started.value.run);
    expect(world.messages.agentMessages.at(-1)?.replyToMessageId).toBe(message.id);
  });
});

describe("naming", () => {
  it("uses the same alias for the same person in every call", () => {
    expect(["nevin", "ana"].map(aliasOf(FOUR))).toEqual(["m1", "m2"]);
  });
});

import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { AgentRun } from "@/domain/agent/ports";
import type { Member } from "@/domain/group/types";
import { settleWithoutModel, type PersonaInput } from "@/domain/persona/persona-brain";
import { personaByKey } from "@/domain/persona/profiles";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "@/domain/plan/statuses";
import { hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw, ViewMember } from "@/domain/plan/view-store";
import { PersonaDirector, type PersonaDirectorDeps } from "./persona-director";

const NOW = new Date("2026-11-01T00:00:00Z");
const maya: Member = { id: "maya", groupId: "g1", displayName: "Maya", currency: "USD", isOrganiser: false, personaKey: "maya" };
const leo: Member = { id: "leo", groupId: "g1", displayName: "Leo", currency: "USD", isOrganiser: false, personaKey: "leo" };
const dan: Member = { id: "dan", groupId: "g1", displayName: "Dan", currency: "USD", isOrganiser: false, personaKey: "dan" };
const judge: Member = { id: "judge", groupId: "g1", displayName: "Judge", currency: "USD", isOrganiser: true };

const viewMember = (id: string, name: string, state: Partial<ViewMember> = {}): ViewMember => ({ id, name, currency: "USD", planAgreement: "pending" as PlanAgreementStatus, approval: "pending" as ApprovalStatus, approvedMinor: null, chargedMinor: null, holdPlaced: false, ...state });

/** A plan of the four, who share one room at about $60 each, unless told otherwise. */
const plan = (status: PlanStatus, overrides: Partial<PlanViewRaw> = {}, states: Record<string, Partial<ViewMember>> = {}): PlanViewRaw => ({
  id: "plan-1", groupId: "g1", title: "Bangkok", summary: null, status, deadlineAt: new Date("2026-11-02T00:00:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 4, replacedByPlanId: null,
  trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [viewMember("judge", "Judge", states.judge), viewMember("maya", "Maya", states.maya), viewMember("leo", "Leo", states.leo), viewMember("dan", "Dan", states.dan)],
  picks: [{ id: "p-hotel", offer: { ...hotel(), totalMinor: 18_000, guests: 4, freeCancellationUntil: "2026-12-10T12:00:00Z" }, memberIds: ["judge", "maya", "leo", "dan"], reason: "", notes: {} }],
  ideas: [], covers: [], bookings: [],
  ...overrides,
});

function setup(options: { raw: PlanViewRaw; people?: Member[]; testCard?: boolean; cardStatus?: "awaiting_card" | "held"; payments?: "stripe" | "demo" | "none"; haveDetails?: boolean }) {
  let raw = options.raw;
  const have = new Set<string>(options.haveDetails ? ["maya", "leo", "dan"] : []);
  const log: string[] = [];
  const said: string[] = [];
  const runs: AgentRun[] = [];
  const run = { id: "run-1" } as unknown as AgentRun;
  const deps: PersonaDirectorDeps = {
    runner: {
      async decide(_group, persona, situation, overrides) {
        const profile = personaByKey(persona.personaKey ?? "");
        if (!profile) return null;
        const input: PersonaInput = { profile, situation, today: "2026-11-01", others: [], chat: [], plan: overrides?.plan ?? null, verdict: overrides?.verdict ?? { ok: true } };
        return situation === "reply" ? { say: "hi there", action: "none" } : settleWithoutModel(input);
      },
      async say(_group, persona, text) {
        said.push(`${persona.displayName}: ${text}`);
      },
    },
    groups: { joinedMembers: async () => options.people ?? [judge, maya, leo] },
    latestPlan: async () => ({ id: raw.id, status: raw.status }),
    views: { load: async () => ok(raw) },
    travellers: { haveDetails: async () => ok(new Set(have)) },
    payments: options.payments ?? "stripe",
    testCard: options.testCard === false ? null : { place: async () => (log.push("test card placed"), ok(undefined)) },
    actions: {
      async plan(persona, _plan, action, seenMinor) {
        log.push(`${persona.displayName} ${action} ${seenMinor}`);
        raw = { ...raw, members: raw.members.map((member) => (member.id === persona.id ? { ...member, ...(action === "agree" ? { planAgreement: "agreed" as PlanAgreementStatus } : { approval: "approved" as ApprovalStatus }) } : member)) };
        return { ok: true, outcome: "done" };
      },
      async requestChanges(persona, _plan, reason, note) {
        log.push(`${persona.displayName} asks ${reason}: ${note}`);
        return ok({ run });
      },
      async saveDetails(persona, _plan, identity) {
        log.push(`${persona.displayName} details ${identity.email}`);
        have.add(persona.id);
        return { ok: true };
      },
      async cardForm(persona) {
        log.push(`${persona.displayName} card form`);
        return { ok: true, clientSecret: "pi_1_secret_x", amountMinor: 4_500, currency: "USD", status: options.cardStatus ?? "awaiting_card" };
      },
      async confirmHold(persona) {
        log.push(`${persona.displayName} confirm hold`);
        raw = { ...raw, members: raw.members.map((member) => (member.id === persona.id ? { ...member, holdPlaced: true } : member)) };
        return { ok: true, outcome: "placed" };
      },
    },
    runAgent: async (started) => void runs.push(started),
    clock: () => NOW,
  };
  return { director: new PersonaDirector(deps), log, said, runs, setRaw: (next: PlanViewRaw) => (raw = next) };
}

describe("PersonaDirector, while the group reviews a plan", () => {
  it("has each persona agree to a plan that suits them, at the price they were shown, and say so", async () => {
    const { director, log, said } = setup({ raw: plan("reviewing"), people: [judge, maya, dan] });
    await director.kick("g1");
    expect(log).toEqual(["Maya agree 4500", "Dan agree 4500"]);
    expect(said).toEqual(["Maya: Looks good to me, I'm in.", "Dan: Looks good to me, I'm in."]);
  });

  it("has the one whose limit is broken ask for changes instead, with the reason, and set Trippy going", async () => {
    // Leo wants a room to himself, and this plan has the three in one room. Maya's $60 is fine.
    const { director, log, runs } = setup({ raw: plan("reviewing"), people: [judge, maya, leo] });
    await director.kick("g1");
    expect(log).toContain("Leo asks different_pick: I'd really need a room to myself. Is there another option?");
    expect(log).not.toContain("Leo agree 4500");
    expect(runs).toHaveLength(1);
  });

  it("asks for a cheaper plan, not just a different one, when the share is over budget", async () => {
    const dear = plan("reviewing", { picks: [{ id: "p", offer: { ...hotel(), totalMinor: 48_000, guests: 4, freeCancellationUntil: "2026-12-10T12:00:00Z" }, memberIds: ["judge", "maya", "leo", "dan"], reason: "", notes: {} }] });
    const { director, log } = setup({ raw: dear, people: [judge, maya] });
    await director.kick("g1");
    expect(log.some((line) => line.startsWith("Maya asks too_expensive"))).toBe(true);
  });

  it("asks only once for the same plan, however often it is kicked", async () => {
    const { director, log } = setup({ raw: plan("reviewing"), people: [judge, leo] });
    await director.kick("g1");
    await director.kick("g1");
    await director.kick("g1");
    expect(log.filter((line) => line.startsWith("Leo asks"))).toHaveLength(1);
  });

  it("stops asking after a few tries in one group", async () => {
    const { director, log, setRaw } = setup({ raw: plan("reviewing"), people: [judge, leo] });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      setRaw(plan("reviewing", { id: `plan-${attempt}` }));
      await director.kick("g1");
    }
    expect(log.filter((line) => line.startsWith("Leo asks"))).toHaveLength(3);
  });

  it("does nothing when the plan is over, or the group has no personas", async () => {
    const ended = setup({ raw: plan("captured") });
    await ended.director.kick("g1");
    expect(ended.log).toEqual([]);
    const none = setup({ raw: plan("reviewing"), people: [judge] });
    await none.director.kick("g1");
    expect(none.log).toEqual([]);
  });

  it("leaves a persona who is not in the plan alone", async () => {
    const without = plan("reviewing", { members: [viewMember("judge", "Judge")] });
    const { director, log } = setup({ raw: without, people: [judge, maya] });
    await director.kick("g1");
    expect(log).toEqual([]);
  });
});

describe("PersonaDirector, when people approve their amounts", () => {
  const approving = (states: Record<string, Partial<ViewMember>> = {}) => plan("approving", {}, { maya: { planAgreement: "agreed", ...states.maya }, dan: { planAgreement: "agreed", ...states.dan }, leo: { planAgreement: "agreed", ...states.leo }, judge: { planAgreement: "agreed" } });
  const danApproved = { dan: { approval: "approved" as ApprovalStatus, approvedMinor: 4_500 } };

  it("approves, then gives its made-up details and puts the test card on the hold", async () => {
    const { director, log } = setup({ raw: approving(), people: [judge, dan] });
    await director.kick("g1");
    expect(log).toEqual(["Dan approve 4500", "Dan details dan.test@example.com", "Dan card form", "test card placed", "Dan confirm hold"]);
  });

  it("only confirms a hold that already has its card, without placing the card again", async () => {
    const { director, log } = setup({ raw: approving(danApproved), people: [judge, dan], haveDetails: true, cardStatus: "held" });
    await director.kick("g1");
    expect(log).toEqual(["Dan card form", "Dan confirm hold"]);
  });

  it("gives its details but no card when the test card is not available", async () => {
    const { director, log } = setup({ raw: approving(danApproved), people: [judge, dan], testCard: false });
    await director.kick("g1");
    expect(log).toEqual(["Dan details dan.test@example.com"]);
  });

  it("does not ask for card or details when holds are pretended", async () => {
    const { director, log } = setup({ raw: approving(danApproved), people: [judge, dan], payments: "demo" });
    await director.kick("g1");
    expect(log).toEqual([]);
  });
});

describe("PersonaDirector.reply", () => {
  it("answers a persona who is named, and nobody else", async () => {
    const { director, said } = setup({ raw: plan("reviewing") });
    await director.reply("g1", "judge", "hey Maya, what's your budget?");
    expect(said).toEqual(["Maya: hi there"]);
  });

  it("stays quiet when nobody is named, and never answers another persona", async () => {
    const { director, said } = setup({ raw: plan("reviewing") });
    await director.reply("g1", "leo", "Maya, thoughts?");
    await director.reply("g1", "judge", "no names here");
    expect(said).toEqual([]);
  });
});

// A fake that errs, to show a refusal from the app stops a persona quietly.
describe("PersonaDirector, when the app refuses", () => {
  it("does not count an action the app refused, and does not say anything", async () => {
    const { director, said } = setup({ raw: plan("reviewing"), people: [judge, maya] });
    const refusing = new PersonaDirector({
      ...(director as unknown as { deps: PersonaDirectorDeps }).deps,
      actions: { ...(director as unknown as { deps: PersonaDirectorDeps }).deps.actions, plan: async () => ({ ok: false, error: "moved on" }), requestChanges: async () => err("moved on") },
    });
    await refusing.kick("g1");
    expect(said).toEqual([]);
  });
});

import type { Result } from "@/lib/result";
import type { AgentRun } from "@/domain/agent/ports";
import type { GroupRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import type { PaymentsMode } from "@/domain/payments/types";
import { checkRules, changeReasonFor, type Verdict } from "@/domain/persona/judge";
import { planBriefFor, planFactsFor } from "@/domain/persona/plan-facts";
import type { PersonaTurn, Situation } from "@/domain/persona/persona-brain";
import { personaByKey, type PersonaIdentity } from "@/domain/persona/profiles";
import type { PersonaRunner } from "@/domain/persona/runner";
import type { PlanStatus } from "@/domain/plan/statuses";
import { buildPlanView, type PlanViewDto } from "@/domain/plan/view";
import type { PlanViewStore } from "@/domain/plan/view-store";
import type { TravellerService } from "@/domain/travellers/service";
import type { CardFormResult, ConfirmHoldResult } from "./hold-actions";
import type { PlanActionName, PlanActionResult } from "./plan-actions";
import type { SaveDetailsResult } from "./traveller-actions";

/** What a persona can do to a plan: exactly what a person can do on the plan screen, done in the persona's name. */
export interface PersonaActions {
  plan(persona: Member, planId: string, action: PlanActionName, seenMinor: number | undefined): Promise<PlanActionResult>;
  requestChanges(persona: Member, planId: string, reason: "too_expensive" | "different_pick", note: string): Promise<Result<{ readonly run: AgentRun | null }, string>>;
  saveDetails(persona: Member, planId: string, identity: PersonaIdentity): Promise<SaveDetailsResult>;
  cardForm(persona: Member, planId: string): Promise<CardFormResult>;
  confirmHold(persona: Member, planId: string): Promise<ConfirmHoldResult>;
}

export interface PersonaDirectorDeps {
  readonly runner: Pick<PersonaRunner, "decide" | "say">;
  readonly groups: Pick<GroupRepository, "joinedMembers">;
  readonly latestPlan: (groupId: string) => Promise<{ readonly id: string; readonly status: PlanStatus } | null>;
  readonly views: Pick<PlanViewStore, "load">;
  readonly travellers: Pick<TravellerService, "haveDetails"> | null;
  readonly payments: PaymentsMode;
  /** Null unless Stripe is in test mode: with a live key a persona never pays. */
  readonly testCard: { place(clientSecret: string): Promise<Result<void, string>> } | null;
  readonly actions: PersonaActions;
  readonly runAgent: (run: AgentRun) => Promise<void>;
  readonly clock: () => Date;
}

/** Plans a persona can still do something about. */
const ACTIVE: readonly PlanStatus[] = ["reviewing", "approving", "held"];
/** One pass lets each persona act once; the next sees what that set in motion. Six covers agree, approve, pay, and a replan in between. */
const MAX_ROUNDS = 6;
/** How often one persona asks for changes in one group, so a persona and Trippy cannot go back and forth for ever. */
const MAX_CHANGE_REQUESTS = 3;

/**
 * Makes a group's simulated personas take part in the plan like real friends: they agree, approve, ask for changes when
 * the plan breaks their own limits, give their made-up hotel details and put a Stripe test card on their hold. Whatever
 * the model says, the rules are applied in code first, and a persona only does what its own screen would let it do.
 */
export class PersonaDirector {
  private readonly running = new Map<string, { again: boolean }>();
  /** Plans a persona already asked changes to, so they ask once per plan. Per server process; the caps below still hold across processes. */
  private readonly asked = new Set<string>();
  private readonly changeRequests = new Map<string, number>();

  constructor(private readonly deps: PersonaDirectorDeps) {}

  /**
   * Lets every persona react to where the plan stands now, and again to what that causes, until nothing is left to do.
   * A second call while one is running makes it look once more instead of running alongside.
   */
  async kick(groupId: string): Promise<void> {
    const held = this.running.get(groupId);
    if (held) {
      held.again = true;
      return;
    }
    const state = { again: false };
    this.running.set(groupId, state);
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        state.again = false;
        const acted = await this.pass(groupId);
        if (!acted && !state.again) return;
      }
    } catch (error) {
      console.error("a persona round failed", error instanceof Error ? error.name : "unknown");
    } finally {
      this.running.delete(groupId);
    }
  }

  /** A persona answers when someone names them in the chat. Personas never answer each other, so they cannot start a conversation that runs on. */
  async reply(groupId: string, senderId: string, body: string): Promise<void> {
    const people = await this.deps.groups.joinedMembers(groupId);
    if (people.find((person) => person.id === senderId)?.personaKey) return;
    const named = people.filter((person) => person.personaKey && new RegExp(`(^|\\W)${escapeRegExp(person.displayName)}(\\W|$)`, "i").test(body));
    for (const persona of named) {
      const turn = await this.deps.runner.decide(groupId, persona, "reply");
      if (turn?.say) await this.deps.runner.say(groupId, persona, turn.say);
    }
  }

  private async pass(groupId: string): Promise<boolean> {
    const personas = (await this.deps.groups.joinedMembers(groupId)).filter((person) => person.personaKey !== undefined);
    if (personas.length === 0) return false;
    const latest = await this.deps.latestPlan(groupId);
    if (!latest || !ACTIVE.includes(latest.status)) return false;

    let acted = false;
    for (const persona of personas) acted = (await this.act(persona, latest.id)) || acted;
    return acted;
  }

  private async act(persona: Member, planId: string): Promise<boolean> {
    const profile = persona.personaKey ? personaByKey(persona.personaKey) : undefined;
    if (!profile) return false;
    const loaded = await this.deps.views.load(planId);
    if (!loaded.ok) return false;
    const raw = loaded.value;

    const have = this.deps.travellers ? await this.deps.travellers.haveDetails([persona.id]) : null;
    const view = buildPlanView(raw, persona.id, { payments: this.deps.payments, ...(have?.ok && { travellers: { given: have.value.has(persona.id) } }) });
    if (!view.me.inPlan) return false;

    const now = this.deps.clock();
    const verdict = checkRules(profile.rules, planFactsFor(raw, persona.id, view.me.shareMinor, now));
    const brief = planBriefFor(raw, persona.id, view.me.shareMinor, now);
    const situation: Situation | null = view.me.actions.agree ? "review_plan" : view.me.actions.approve ? "approve_amount" : null;

    if (situation) {
      const turn = await this.deps.runner.decide(raw.groupId, persona, situation, { plan: brief, verdict });
      return turn ? this.respond(persona, raw.id, view, turn, verdict) : false;
    }
    if (this.deps.payments === "stripe" && raw.status === "approving" && view.me.approval === "approved" && view.me.awaitingDetails) return this.pay(persona, raw.id, view, profile.identity);
    return false;
  }

  private async respond(persona: Member, planId: string, view: PlanViewDto, turn: PersonaTurn, verdict: Verdict): Promise<boolean> {
    if (turn.action === "ask_changes") return this.askChanges(persona, planId, turn, verdict);
    if (turn.action !== "agree" && turn.action !== "approve") return false;

    const done = await this.deps.actions.plan(persona, planId, turn.action, view.me.shareMinor ?? undefined);
    if (!done.ok) return false;
    // A price that moved since the persona looked records nothing; the next round decides again on the new price.
    if (done.outcome === "done" && turn.say) await this.deps.runner.say(persona.groupId, persona, turn.say);
    return true;
  }

  private async askChanges(persona: Member, planId: string, turn: PersonaTurn, verdict: Verdict): Promise<boolean> {
    const key = `${planId}:${persona.id}`;
    const total = this.changeRequests.get(persona.id) ?? 0;
    if (this.asked.has(key) || total >= MAX_CHANGE_REQUESTS) return false;
    this.asked.add(key);
    this.changeRequests.set(persona.id, total + 1);

    const sent = await this.deps.actions.requestChanges(persona, planId, changeReasonFor(verdict.ok ? [] : verdict.codes), turn.say ?? "");
    if (!sent.ok) return false;
    // Trippy answers with a new plan, which the next round shows to everyone.
    if (sent.value.run) await this.deps.runAgent(sent.value.run);
    return true;
  }

  /** Gives the persona's made-up hotel details, then puts the Stripe test card on their hold. Each step only when the screen would ask for it. */
  private async pay(persona: Member, planId: string, view: PlanViewDto, identity: PersonaIdentity): Promise<boolean> {
    let progressed = false;
    if (view.me.details.needed) {
      const saved = await this.deps.actions.saveDetails(persona, planId, identity);
      if (!saved.ok) return false;
      progressed = true;
    }
    if (!view.me.cardNeeded || !this.deps.testCard) return progressed;

    const form = await this.deps.actions.cardForm(persona, planId);
    if (!form.ok) return progressed;
    if (form.status === "awaiting_card") {
      const placed = await this.deps.testCard.place(form.clientSecret);
      if (!placed.ok) {
        console.error("a persona's test card failed");
        return progressed;
      }
    }
    const confirmed = await this.deps.actions.confirmHold(persona, planId);
    return confirmed.ok || progressed;
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

import "server-only";
import { err, ok } from "@/lib/result";
import { runAgent, createUsageMeter, type AgentDeps } from "@/domain/agent/run-agent";
import type { GroupRepository } from "@/domain/group/repository";
import type { HoldService } from "@/domain/payments/hold-service";
import type { PaymentsMode } from "@/domain/payments/types";
import { PersonaRunner } from "@/domain/persona/runner";
import { PersonaService } from "@/domain/persona/service";
import type { PersonaStore } from "@/domain/persona/ports";
import type { PlanService } from "@/domain/plan/service";
import type { PlanViewStore } from "@/domain/plan/view-store";
import type { TravellerService } from "@/domain/travellers/service";
import type { StripeTestCard } from "@/infrastructure/stripe/test-card";
import { runCardForm, runConfirmHold } from "./hold-actions";
import { PersonaDirector } from "./persona-director";
import { runPlanAction } from "./plan-actions";
import { runRequestChanges } from "./request-changes";
import { runSaveTravellerDetails } from "./traveller-actions";

export interface Personas {
  readonly service: PersonaService;
  readonly runner: PersonaRunner;
  readonly director: PersonaDirector;
}

export interface PersonaWiring {
  readonly groups: GroupRepository;
  readonly store: PersonaStore;
  readonly agent: AgentDeps;
  readonly plans: PlanService;
  readonly views: PlanViewStore;
  readonly travellers: TravellerService | null;
  readonly holds: HoldService | null;
  readonly payments: PaymentsMode;
  readonly testCard: StripeTestCard | null;
}

/** Puts the simulated test personas together: who may be added, what they say, and what they do to a plan, which is what a person can do on the plan screen. */
export function buildPersonas({ groups, store, agent, plans, views, travellers, holds, payments, testCard }: PersonaWiring): Personas {
  const { messages } = agent;
  const runner = new PersonaRunner({ groups, messages, store, model: () => agent.makeChatModel(createUsageMeter()), clock: agent.clock });
  const director = new PersonaDirector({
    runner,
    groups,
    latestPlan: (groupId) => agent.plans.latest(groupId),
    views,
    travellers,
    payments,
    testCard,
    actions: {
      plan: (persona, planId, action, seenMinor) => runPlanAction({ plans, views, messages, clock: agent.clock }, persona, { planId, action, seenMinor }),
      requestChanges: async (persona, planId, reason, note) => {
        const sent = await runRequestChanges({ views, send: { messages, agent }, payments }, persona, { planId, reason, note });
        return sent.ok ? ok({ run: sent.value.run }) : err(sent.error);
      },
      saveDetails: (persona, planId, identity) => runSaveTravellerDetails({ travellers, views, holds }, persona, planId, identity),
      cardForm: (persona, planId) => runCardForm({ holds, views, travellers }, persona, planId),
      confirmHold: (persona, planId) => runConfirmHold({ holds, views }, persona, planId),
    },
    runAgent: (run) => runAgent(agent, run),
    clock: agent.clock,
  });
  return { service: new PersonaService({ store, messages }), runner, director };
}

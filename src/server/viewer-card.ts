import type { PaymentsMode } from "@/domain/payments/types";
import { buildPlanView } from "@/domain/plan/view";
import type { PlanViewStore } from "@/domain/plan/view-store";
import type { CardMine } from "@/lib/plan-card";

/** How long what a card says about someone is kept. Short: Agree checks today's price on the server anyway. */
const KEEP_MS = 5_000;
const MAX_KEPT = 500;

export interface ViewerCardDeps {
  readonly views: Pick<PlanViewStore, "load">;
  readonly payments: PaymentsMode;
  readonly clock: () => Date;
}

/**
 * Works out, for one person, what a plan card in the chat should offer them: their price and whether they can agree
 * yet. It uses the same code as the plan screen, so the two can never disagree about the price. The chat asks every
 * couple of seconds, so each answer is kept for a few seconds instead of reading the whole plan every time.
 */
export class ViewerCards {
  private readonly kept = new Map<string, { readonly at: number; readonly card: CardMine | null }>();

  constructor(private readonly deps: ViewerCardDeps) {}

  async forPlan(planId: string, memberId: string): Promise<CardMine | null> {
    const now = this.deps.clock().getTime();
    const key = `${planId}:${memberId}`;
    const held = this.kept.get(key);
    if (held && now - held.at < KEEP_MS) return held.card;

    const card = await this.read(planId, memberId);
    this.remember(key, now, card);
    return card;
  }

  private async read(planId: string, memberId: string): Promise<CardMine | null> {
    const raw = await this.deps.views.load(planId);
    if (!raw.ok) return null;
    const { me, currency, people } = buildPlanView(raw.value, memberId, { payments: this.deps.payments });
    if (!me.inPlan) return null;
    return {
      canAgree: me.actions.agree,
      agreed: me.agreement === "agreed",
      canRequestChanges: me.actions.requestChanges,
      shareMinor: me.shareMinor,
      currency,
      lines: people.find((person) => person.isMe)?.lines ?? [],
      people: people.map((person) => ({ name: person.name, isMe: person.isMe, agreed: person.agreement === "agreed", approved: person.approval === "approved", held: person.holdPlaced })),
      needsAmount: me.actions.approve || me.cardNeeded,
    };
  }

  private remember(key: string, at: number, card: CardMine | null): void {
    if (this.kept.size >= MAX_KEPT) {
      for (const [oldKey, entry] of this.kept) if (at - entry.at >= KEEP_MS) this.kept.delete(oldKey);
      if (this.kept.size >= MAX_KEPT) this.kept.clear();
    }
    this.kept.set(key, { at, card });
  }
}

"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMinor } from "@/lib/format-money";
import { describePlanCard, type CardPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";
import { agreeToPlan } from "./plan/[planId]/actions";

type Outcome = { readonly kind: "agreed" } | { readonly kind: "note"; readonly text: string };

/**
 * The card under the agent's plan announcement. It shows where that plan stands and opens it. A plan that a newer one
 * replaced points to the newer one, since that is the one the group is working on. On the plan being decided it also
 * offers the person their next step, so they can agree without leaving the chat.
 */
export function PlanCard({ groupId, planId, plans }: { readonly groupId: string; readonly planId: string; readonly plans: readonly CardPlan[] }) {
  const view = describePlanCard(planId, plans);
  const target = view.opens;
  const mine = view.state === "live" ? (plans.find((plan) => plan.id === planId)?.mine ?? null) : null;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function agree() {
    if (!mine || mine.shareMinor === null) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await agreeToPlan(groupId, planId, mine.shareMinor);
      if (!result.ok) return setOutcome({ kind: "note", text: result.error });
      if (result.outcome === "price_changed") return setOutcome({ kind: "note", text: `The price changed to ${formatMinor(result.currentMinor, mine.currency)}. Open the plan to look at it.` });
      if (result.outcome === "plan_ended") return setOutcome({ kind: "note", text: "This plan has ended." });
      setOutcome({ kind: "agreed" });
    } catch {
      setOutcome({ kind: "note", text: "Couldn't reach the server. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{view.title}</p>
        {view.people ? <p className="text-xs text-muted-foreground">{view.people}</p> : null}
        <p className={cn("mt-1 text-xs font-medium", view.state === "live" ? "text-primary" : "text-muted-foreground")}>{view.detail}</p>
        {target ? <p className="mt-1 text-xs font-semibold text-primary">{view.state === "live" ? "Open the plan" : "See the newer plan"}</p> : null}
      </div>
      {target ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  const style = cn("mt-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2", view.state !== "live" && "opacity-80");
  const body = target ? (
    <Link href={`/g/${groupId}/plan/${target}`} className={cn(style, "hover:bg-muted")}>
      {content}
    </Link>
  ) : (
    <div className={style}>{content}</div>
  );

  const agreed = mine?.agreed || outcome?.kind === "agreed";
  return (
    <div>
      {body}
      {mine ? (
        <div className="mt-2 space-y-1.5">
          {mine.canAgree && !agreed && mine.shareMinor !== null ? (
            <Button type="button" className="h-11 w-full rounded-full text-sm font-semibold" disabled={busy} onClick={() => void agree()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : `Agree · ${formatMinor(mine.shareMinor, mine.currency)}`}
            </Button>
          ) : null}
          {agreed && !mine.needsAmount ? <p className="px-1 text-xs font-medium text-success">You agreed. Waiting for the others.</p> : null}
          {mine.needsAmount ? (
            <Link href={`/g/${groupId}/plan/${planId}`} className="flex h-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              Approve your amount
            </Link>
          ) : null}
          {outcome?.kind === "note" ? (
            <p role="status" className="px-1 text-xs text-muted-foreground">
              {outcome.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

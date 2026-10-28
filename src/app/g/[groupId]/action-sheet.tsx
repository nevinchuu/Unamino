"use client";

import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/status-chip";
import { formatMinor } from "@/lib/format-money";
import { describeSheet, type CardMine, type CardPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";
import { agreeToPlan } from "./plan/[planId]/actions";
import { ChangeRequestSheet } from "./plan/[planId]/change-request-sheet";

const STEPS = ["Agree", "Approve", "Book"] as const;

interface ActionSheetProps {
  readonly groupId: string;
  readonly plan: CardPlan;
  readonly mine: CardMine;
  /** Called when a request for changes reached Trippy, with whether it could start on it right away. */
  readonly onChangesSent: (asked: boolean) => void;
}

/**
 * The panel above the composer for the plan the group is deciding on. It shows where the plan stands ("2/4 agreed")
 * and offers this person their next step: agree to it, ask for changes, or approve their amount. It opens by itself
 * while there is something to do and folds away while the person is only waiting, and either can be changed by tapping the handle.
 */
export function ActionSheet({ groupId, plan, mine, onChangesSent }: ActionSheetProps) {
  const view = describeSheet(plan, mine);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const open = chosen ?? view.actionable;

  async function agree() {
    if (mine.shareMinor === null) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await agreeToPlan(groupId, plan.id, mine.shareMinor);
      if (!result.ok) return setNote(result.error);
      if (result.outcome === "price_changed") return setNote(`The price changed to ${formatMinor(result.currentMinor, mine.currency)}. Open the plan to look at it.`);
      if (result.outcome === "plan_ended") return setNote("This plan has ended.");
      // The next poll brings the new count; the person has agreed, so there is nothing left for them to press.
    } catch {
      setNote("Couldn't reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const share = mine.shareMinor !== null ? formatMinor(mine.shareMinor, mine.currency) : null;
  return (
    <section aria-label="Plan decision" className="flex flex-col gap-3 rounded-t-[26px] bg-card px-5 pt-2.5 pb-4 shadow-sheet">
      <button type="button" onClick={() => setChosen(!open)} aria-expanded={open} className="flex min-h-9 items-center justify-between gap-3">
        <span className="flex w-11 justify-start text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
        <span className="h-[5px] w-11 rounded-full bg-border" aria-hidden="true" />
        <StatusChip tone="success" className="text-xs">
          {view.pill}
        </StatusChip>
      </button>

      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-extrabold">{view.step === "approve" ? "Approve your amount" : plan.title}</h2>
        {view.note ? <p className="text-[13px] text-muted-foreground">{view.note}</p> : null}
      </div>

      {open ? (
        <>
          {view.step === "agree" && share ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-background px-3.5 py-3">
              {mine.lines.map((line) => (
                <div key={line.label} className="flex justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{line.label}</span>
                  <span className="font-bold">{formatMinor(line.minor, mine.currency)}</span>
                </div>
              ))}
              {mine.lines.length > 0 ? <div className="h-px bg-border" /> : null}
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-muted-foreground">Your share</span>
                <span className="text-xl font-extrabold">{share}</span>
              </div>
            </div>
          ) : null}

          {view.step === "approve" && view.actionable && share ? (
            <p className="text-[13px] leading-[19px] text-muted-foreground">Your card is held for up to {share}, not charged. We only charge when everyone is in, and release anything above today&apos;s share.</p>
          ) : null}

          <div className="flex gap-2.5">
            {mine.canRequestChanges ? (
              <Button type="button" variant="secondary" className="h-12 flex-1 rounded-2xl text-sm font-bold" onClick={() => setChangesOpen(true)}>
                I need changes
              </Button>
            ) : null}
            {view.step === "agree" && view.actionable && share ? (
              <Button type="button" variant="action" className="h-12 flex-[1.4] rounded-2xl text-sm" disabled={busy} onClick={() => void agree()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : `Agree · ${share}`}
              </Button>
            ) : null}
            {view.step === "approve" && view.actionable ? (
              <Link href={`/g/${groupId}/plan/${plan.id}`} className={cn(buttonVariants({ variant: "action" }), "h-12 flex-[1.4] rounded-2xl text-sm")}>
                Approve your amount
              </Link>
            ) : null}
          </div>

          {note ? (
            <p role="status" className="text-xs text-muted-foreground">
              {note}
            </p>
          ) : null}

          <ol className="flex justify-center gap-1.5" aria-label={`Step ${view.stepNumber} of ${STEPS.length}: ${STEPS[view.stepNumber - 1]}`}>
            {STEPS.map((label, index) => (
              <li key={label} className={cn("size-[7px] rounded-full", index + 1 === view.stepNumber ? "bg-primary" : "bg-border")} />
            ))}
          </ol>
        </>
      ) : null}

      <ChangeRequestSheet
        open={changesOpen && mine.canRequestChanges}
        onOpenChange={setChangesOpen}
        groupId={groupId}
        planId={plan.id}
        onSent={(asked) => {
          setChangesOpen(false);
          onChangesSent(asked);
        }}
      />
    </section>
  );
}

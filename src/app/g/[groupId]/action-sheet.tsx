"use client";

import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { MoneyExplainer } from "@/components/money-explainer";
import { PlanCountdown } from "@/components/plan-countdown";
import { StatusChip } from "@/components/status-chip";
import { formatMinor } from "@/lib/format-money";
import { describeSheet, type CardMine, type CardPlan } from "@/lib/plan-card";
import { previousShareNote } from "@/lib/share-change";
import { cn } from "@/lib/utils";
import { ApprovalList, ApprovalStrip } from "./approval-strip";
import { CoverAction } from "./cover-action";
import { PlanPreview } from "./plan-preview";
import { remindGroup } from "./actions";
import { agreeToPlan } from "./plan/[planId]/actions";
import { ChangeRequestSheet } from "./plan/[planId]/change-request-sheet";

const STEPS = ["Agree", "Approve", "Book"] as const;

interface ActionSheetProps {
  readonly groupId: string;
  readonly plan: CardPlan;
  readonly mine: CardMine;
  /** Called when a request for changes reached Trippy, with whether it could start on it right away. */
  readonly onChangesSent: (asked: boolean) => void;
  /** The person is typing, so the sheet folds up and leaves the room to the chat and the keyboard. */
  readonly folded?: boolean;
}

/**
 * The panel above the composer for the plan the group is deciding on. It shows where the plan stands ("1/4 approved", with a ring for each person)
 * and offers this person their next step: agree to it, ask for changes, or approve their amount. A small button at the side
 * covers a friend's share without opening the full plan. It opens by itself
 * while there is something to do and folds away while the person is only waiting, and either can be changed by tapping the handle.
 */
export function ActionSheet({ groupId, plan, mine, onChangesSent, folded = false }: ActionSheetProps) {
  const view = describeSheet(plan, mine);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reminded, setReminded] = useState(false);
  const open = !folded && (chosen ?? view.actionable);
  const big = open && detailsOpen;

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

  async function remind() {
    setBusy(true);
    setNote(null);
    try {
      const result = await remindGroup(groupId, plan.id);
      if (!result.ok) return setNote(result.error);
      setReminded(true);
      setNote("Reminder sent in the chat.");
    } catch {
      setNote("Couldn't reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const share = mine.shareMinor !== null ? formatMinor(mine.shareMinor, mine.currency) : null;
  const previousNote = previousShareNote(mine.shareMinor, mine.previousShareMinor, mine.currency);
  // A friend covering the whole share leaves nothing to pay, which reads better as a word than as $0.00.
  const covered = mine.shareMinor === 0;
  return (
    <section aria-label="Plan decision" className={cn("flex flex-col gap-3 overflow-y-auto rounded-t-[26px] bg-card px-5 pt-2.5 pb-4 shadow-sheet", big ? "max-h-[85dvh]" : "max-h-[55dvh]")}>
      <button type="button" onClick={() => setChosen(!open)} aria-expanded={open} className="flex min-h-9 items-center justify-between gap-3">
        <span className="flex w-11 justify-start text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
        <span className="h-[5px] w-11 rounded-full bg-border" aria-hidden="true" />
        <span className="flex items-center gap-2">
          <PlanCountdown deadlineAt={plan.deadlineAt} />
          <StatusChip tone="success" className="text-xs">
            {view.pill}
          </StatusChip>
        </span>
      </button>

      <ApprovalStrip people={mine.people} />

      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-extrabold">{view.step === "approve" ? "Approve your amount" : plan.title}</h2>
        {view.note ? <p className="text-[13px] text-muted-foreground">{view.note}</p> : null}
        {!open && view.step === "agree" && view.actionable ? <p className="text-[13px] text-muted-foreground">Agree first, it costs nothing. Approving your amount comes next.</p> : null}
      </div>

      {!open && view.actionable && share ? (
        view.step === "agree" ? (
          <Button type="button" variant="action" className="h-11 rounded-2xl text-sm" disabled={busy} onClick={() => void agree()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : covered ? "Agree · covered" : `Agree · ${share}`}
          </Button>
        ) : (
          <Link href={`/g/${groupId}/plan/${plan.id}`} className={cn(buttonVariants({ variant: "action" }), "h-11 rounded-2xl text-sm")}>
            {covered ? "Open the plan" : "Approve your amount"}
          </Link>
        )
      ) : null}

      {open ? (
        <>
          <ApprovalList people={mine.people} />

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
              {previousNote ? <p className="text-right text-xs text-muted-foreground">{previousNote}</p> : null}
            </div>
          ) : null}

          {view.step === "approve" && view.actionable && share ? (
            covered ? (
              <p className="text-[13px] leading-[19px] text-muted-foreground">A friend is covering your whole share, so there is no card to add. Open the plan to give your traveller details.</p>
            ) : mine.shareMinor !== null ? (
              <MoneyExplainer amountMinor={mine.shareMinor} currency={mine.currency} compact={{ moreHref: `/g/${groupId}/plan/${plan.id}` }} />
            ) : null
          ) : null}

          {view.step === "agree" && view.actionable && share ? (
            <p className="text-[13px] leading-[19px] text-muted-foreground">Agreeing costs nothing and your money is not touched. Next you approve your own amount, and only then does your bank set that amount aside. Nothing is charged until everyone is in and the trip is booked.</p>
          ) : null}

          <button type="button" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen} className="flex min-h-11 items-center justify-center gap-1 self-center text-sm font-semibold text-link">
            {detailsOpen ? "Hide plan details" : "View plan details"}
            {detailsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {detailsOpen ? <PlanPreview detail={mine.detail} planHref={`/g/${groupId}/plan/${plan.id}`} /> : null}

          <div className={cn("flex gap-2.5", big && "sticky bottom-0 -mx-5 bg-card px-5 pt-2")}>
            {mine.canCover ? <CoverAction planId={plan.id} onNote={setNote} /> : null}
            {mine.canRequestChanges ? (
              <Button type="button" variant="secondary" className="h-12 flex-1 rounded-2xl text-sm font-bold" onClick={() => setChangesOpen(true)}>
                I need changes
              </Button>
            ) : null}
            {view.step === "agree" && view.actionable && share ? (
              <Button type="button" variant="action" className="h-12 flex-[1.4] rounded-2xl text-sm" disabled={busy} onClick={() => void agree()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : covered ? "Agree · covered" : `Agree · ${share}`}
              </Button>
            ) : null}
            {view.step === "approve" && view.actionable ? (
              <Link href={`/g/${groupId}/plan/${plan.id}`} className={cn(buttonVariants({ variant: "action" }), "h-12 flex-[1.4] rounded-2xl text-sm")}>
                {covered ? "Open the plan" : "Approve your amount"}
              </Link>
            ) : null}
          </div>

          {view.canRemind && !reminded ? (
            <button type="button" disabled={busy} onClick={() => void remind()} className="min-h-11 self-center text-sm font-semibold text-link">
              Remind the others
            </button>
          ) : null}

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

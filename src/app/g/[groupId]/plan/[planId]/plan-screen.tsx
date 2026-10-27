"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppBar } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { LIVE_PLAN_STATUSES, type PlanViewDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";
import { countdownText, describeStage, priceHoldElapsed } from "@/lib/plan-stage";
import { cn } from "@/lib/utils";
import type { PlanActionResult } from "@/server/plan-actions";
import { agreeToPlan, approvePlanAmount, declinePlan, declinePlanAmount } from "./actions";
import { CardSheet } from "./card-sheet";
import { IdeaCard, ItemCard } from "./plan-items";
import { TripConfirmed } from "./trip-confirmed";
import { WhoPays } from "./who-pays";

/** How often the screen asks where the plan stands. Slower once nobody is deciding any more. */
const POLL_LIVE_MS = 4_000;
const POLL_FINISHED_MS = 15_000;
const HIDDEN_RECHECK_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

/** Stripe's publishable key. It is public by design, and is read at build time. */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

type Busy = "agree" | "approve" | "decline" | "declineAmount";
type Notice = { readonly tone: "error" | "info"; readonly text: string };

const TONE_STYLES = {
  action: "bg-accent text-accent-foreground",
  waiting: "bg-muted text-foreground",
  good: "bg-success/10 text-success",
  ended: "bg-muted text-muted-foreground",
} as const;

export function PlanScreen({ initial }: { readonly initial: PlanViewDto }) {
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [confirming, setConfirming] = useState<"decline" | "declineAmount" | null>(null);
  const [gone, setGone] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const live = LIVE_PLAN_STATUSES.includes(view.status);
  const planId = initial.id;

  const refetch = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      const response = await fetch(`/api/plans/${planId}/view`, { cache: "no-store", signal });
      if (response.status === 404) {
        setGone(true);
        return true;
      }
      if (!response.ok) throw new Error(`plan answered ${response.status}`);
      setView((await response.json()) as PlanViewDto);
      return true;
    },
    [planId],
  );

  // Keeps the screen current: ticks appear as others act, and the deadline moves when the prices are renewed.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();
    const interval = live ? POLL_LIVE_MS : POLL_FINISHED_MS;

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void tick(), ms);
    };
    async function tick() {
      if (document.visibilityState === "hidden") return schedule(HIDDEN_RECHECK_MS);
      try {
        await refetch(controller.signal);
        failures = 0;
        schedule(interval);
      } catch {
        if (cancelled) return;
        failures += 1;
        schedule(Math.min(interval * 2 ** failures, MAX_BACKOFF_MS));
      }
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule(interval);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, refetch]);

  // The countdown ticks once a second, and only while it means something.
  useEffect(() => {
    if (!live) return;
    const ticking = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(ticking);
  }, [live]);

  // After the details are saved the view says they are no longer needed, which is what turns the sheet over to the card.
  const detailsSaved = useCallback(() => {
    void refetch();
  }, [refetch]);

  const cardPlaced = useCallback(() => {
    setCardOpen(false);
    void refetch();
  }, [refetch]);

  async function perform(name: Busy, call: () => Promise<PlanActionResult>) {
    setBusy(name);
    setNotice(null);
    setConfirming(null);
    try {
      const result = await call();
      if (!result.ok) setNotice({ tone: "error", text: result.error });
      else if (result.outcome === "price_changed") {
        setNotice({ tone: "info", text: `The price changed to ${formatMinor(result.currentMinor, view.currency)}. Have a look, and tap again if it is still fine.` });
      } else if (result.outcome === "plan_ended") {
        setNotice({ tone: "info", text: result.reason === "listing_unavailable" ? "A flight or hotel in the plan is no longer available, so the plan has ended." : "The plan ran out of time, so it has ended." });
      }
      await refetch();
      // With real cards the next step after approving is adding the card, so the form opens straight away.
      if (name === "approve" && result.ok && result.outcome === "done" && view.payments === "stripe") setCardOpen(true);
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const { me } = view;
  const stage = describeStage(view);
  const deadline = new Date(view.deadlineAt);
  const subtitle = [view.dates, `${view.headcount} ${view.headcount === 1 ? "person" : "people"}`].filter(Boolean).join(" · ");

  if (gone) {
    return (
      <>
        <AppBar title="Plan" backHref={`/g/${view.groupId}`} />
        <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
          <h2 className="text-xl font-semibold">We couldn&apos;t find this plan</h2>
          <Link href={`/g/${view.groupId}`} className="text-sm font-medium text-primary">
            Back to the chat
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <AppBar title={view.title} subtitle={subtitle} backHref={`/g/${view.groupId}`} />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-6">
        {view.reference ? (
          <TripConfirmed view={view} />
        ) : (
          <section className={cn("rounded-xl px-4 py-3", TONE_STYLES[stage.tone])} aria-live="polite">
            {stage.step ? <p className="text-xs font-semibold tracking-wide uppercase opacity-80">{stage.step}</p> : null}
            <p className="text-lg font-semibold">{stage.headline}</p>
            <p className="text-sm opacity-90">{stage.detail}</p>
            {live ? (
              <p className="mt-2 text-xs opacity-80" suppressHydrationWarning>
                {priceHoldElapsed(deadline, new Date(now))
                  ? "Checking the latest prices again…"
                  : `Prices held until ${deadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${countdownText(deadline, new Date(now))}`}
              </p>
            ) : null}
          </section>
        )}

        {view.demoBooking && view.status === "booked" ? (
          <p className="px-1 text-xs text-muted-foreground">Demo: no flights or hotel were really booked.</p>
        ) : null}

        {!view.pricesAvailable ? (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            The prices can&apos;t be worked out right now, so nobody can agree yet. This screen will keep trying.
          </p>
        ) : null}

        {view.summary ? <p className="px-1 text-sm text-muted-foreground">{view.summary}</p> : null}

        <section aria-labelledby="plan-heading" className="space-y-3">
          <h2 id="plan-heading" className="px-1 text-sm font-medium text-muted-foreground">
            {view.reference ? "Your trip" : "The plan"}
          </h2>
          {view.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </section>

        {view.ideas.length > 0 ? (
          <section aria-labelledby="ideas-heading" className="space-y-3">
            <h2 id="ideas-heading" className="px-1 text-sm font-medium text-muted-foreground">
              Ideas for your free time
            </h2>
            {view.ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </section>
        ) : null}

        <WhoPays people={view.people} status={view.status} currency={view.currency} payments={view.payments} />
      </div>

      <div className="border-t border-border bg-background px-4 pt-3 pb-4">
        {notice ? (
          <p role={notice.tone === "error" ? "alert" : "status"} className={cn("mb-3 rounded-lg px-3 py-2 text-sm", notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground")}>
            {notice.text}
          </p>
        ) : null}

        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">
              {confirming === "decline" ? "Saying no ends the plan for everyone. Anyone can ask the agent for a new one afterwards." : "Backing out ends the plan for everyone and gives every hold back. Anyone can ask the agent for a new one afterwards."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="h-11 flex-1 rounded-full" onClick={() => setConfirming(null)}>
                Keep the plan
              </Button>
              <Button type="button" variant="destructive" className="h-11 flex-1 rounded-full" disabled={busy !== null} onClick={() => perform(confirming, () => (confirming === "decline" ? declinePlan(view.groupId, view.id) : declinePlanAmount(view.groupId, view.id)))}>
                {busy === confirming ? <Loader2 className="size-4 animate-spin" /> : confirming === "decline" ? "End the plan" : "Back out"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {me.actions.agree && me.shareMinor !== null ? (
              <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" disabled={busy !== null} onClick={() => perform("agree", () => agreeToPlan(view.groupId, view.id, me.shareMinor as number))}>
                {busy === "agree" ? <Loader2 className="size-5 animate-spin" /> : `Agree to this plan · ${formatMinor(me.shareMinor, view.currency)}`}
              </Button>
            ) : null}

            {me.cardNeeded && me.approvedMinor !== null ? (
              <>
                <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" onClick={() => setCardOpen(true)}>
                  {me.details.needed ? "Add your details and card" : "Add your card"} · {formatMinor(me.approvedMinor, view.currency)}
                </Button>
                <p className="text-center text-xs text-muted-foreground">A hold for this amount, not a charge.</p>
              </>
            ) : null}

            {me.actions.approve && me.shareMinor !== null ? (
              <>
                <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" disabled={busy !== null} onClick={() => perform("approve", () => approvePlanAmount(view.groupId, view.id, me.shareMinor as number))}>
                  {busy === "approve" ? <Loader2 className="size-5 animate-spin" /> : `Approve ${formatMinor(me.shareMinor, view.currency)}`}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  A hold for this amount, not a charge.{view.payments === "demo" ? " Demo: no real card is held." : ""}
                </p>
              </>
            ) : null}

            {me.actions.decline ? (
              <button type="button" onClick={() => setConfirming("decline")} className="mx-auto block text-sm font-medium text-muted-foreground hover:text-foreground">
                {me.agreement === "agreed" ? "Change my mind" : "Not for me"}
              </button>
            ) : null}
            {me.actions.declineAmount ? (
              <button type="button" onClick={() => setConfirming("declineAmount")} className="mx-auto block text-sm font-medium text-muted-foreground hover:text-foreground">
                Back out
              </button>
            ) : null}

            {!me.actions.agree && !me.actions.approve && !me.actions.decline && !me.actions.declineAmount && !me.cardNeeded ? (
              <Link href={`/g/${view.groupId}`} className="block text-center text-sm font-medium text-primary">
                Back to the chat
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <CardSheet
        // Once the hold is recorded (by this person, or by Stripe telling the server first) there is nothing left to add, so the sheet goes.
        open={cardOpen && me.cardNeeded}
        onOpenChange={setCardOpen}
        groupId={view.groupId}
        planId={view.id}
        amountText={me.approvedMinor !== null ? formatMinor(me.approvedMinor, view.currency) : ""}
        publishableKey={PUBLISHABLE_KEY}
        onPlaced={cardPlaced}
        detailsNeeded={me.details.needed}
        passportRequired={me.details.passportRequired}
        onDetailsSaved={detailsSaved}
      />
    </>
  );
}

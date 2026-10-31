"use client";

import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import type { FormState } from "@/server/forms";
import { startDemoGroup, startFailingDemoGroup } from "./actions";

const INITIAL: FormState = {};

/** One tap to try the whole flow alone, with simulated friends and a first plan already being made. */
export function DemoButton() {
  const [state, formAction, pending] = useActionState(startDemoGroup, INITIAL);
  const [failingState, failingAction, failingPending] = useActionState(startFailingDemoGroup, INITIAL);
  const message = state.message ?? failingState.message;

  return (
    <form action={formAction} className="flex flex-col gap-2 px-6 pt-5">
      <button
        type="submit"
        disabled={pending || failingPending}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-soft transition-transform active:scale-[0.99] disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Try the demo with test friends
      </button>
      <p className="px-1 text-center text-xs text-muted-foreground">Makes a group with three simulated friends and starts a Bangkok plan for you. Test data only.</p>
      <button
        type="submit"
        formAction={failingAction}
        disabled={pending || failingPending}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 text-sm font-bold text-foreground transition-transform active:scale-[0.99] disabled:opacity-70"
      >
        {failingPending ? <Loader2 className="size-4 animate-spin" /> : <TriangleAlert className="size-4" />}
        Try the demo where booking fails
      </button>
      <p className="px-1 text-center text-xs text-muted-foreground">The same, but the last booking check fails on purpose: the hotel is cancelled, every card hold is let go and nobody is charged.</p>
      {message ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <p className="pt-2 text-center text-xs font-medium text-muted-foreground">or make your own group</p>
    </form>
  );
}

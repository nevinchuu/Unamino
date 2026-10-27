"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { getStripe, isTestKey, outcomeOfCardEntry, TEST_CARD_HINT } from "@/lib/stripe-browser";
import { confirmCardHold, openCardForm } from "./actions";

interface CardSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groupId: string;
  readonly planId: string;
  /** The amount being held, already written for a person: "$290.09". */
  readonly amountText: string;
  /** Stripe's publishable key, which is public by design. Null when the server has none. */
  readonly publishableKey: string | null;
  /** Called once the hold is recorded, so the screen can move on. */
  readonly onPlaced: () => void;
}

type Loaded = { readonly state: "loading" } | { readonly state: "ready"; readonly clientSecret: string } | { readonly state: "error"; readonly message: string };

const APPEARANCE = {
  theme: "stripe",
  variables: { colorPrimary: "#2347D6", colorText: "#17181C", borderRadius: "10px", fontFamily: "Plus Jakarta Sans, system-ui, sans-serif" },
} as const;

/** The card form for one person's hold, in a sheet over the plan. The card number goes straight to Stripe's own fields. */
export function CardSheet({ open, onOpenChange, groupId, planId, amountText, publishableKey, onPlaced }: CardSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add your card</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">We hold {amountText} on your card. It is not a charge. You are only charged once everyone is in and the trip is booked, and the hold is let go if the plan ends.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-2 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          {/* Only mounted while open, so the hold is made when the person asks for the form and not before. */}
          {open ? <Body groupId={groupId} planId={planId} amountText={amountText} publishableKey={publishableKey} onPlaced={onPlaced} onClose={() => onOpenChange(false)} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({ groupId, planId, amountText, publishableKey, onPlaced, onClose }: Omit<CardSheetProps, "open" | "onOpenChange"> & { readonly onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  // Asks the server for this person's hold. If the card is already on it (they were interrupted), it is recorded straight away.
  useEffect(() => {
    if (!publishableKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const form = await openCardForm(groupId, planId);
        if (cancelled) return;
        if (!form.ok) return setLoaded({ state: "error", message: form.error });
        if (form.status === "held") {
          const confirmed = await confirmCardHold(groupId, planId);
          if (cancelled) return;
          if (confirmed.ok && confirmed.outcome !== "waiting") return onPlaced();
        }
        setLoaded({ state: "ready", clientSecret: form.clientSecret });
      } catch {
        if (!cancelled) setLoaded({ state: "error", message: "Couldn't reach the server. Check your connection and try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, planId, publishableKey, onPlaced]);

  if (!publishableKey) {
    return <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Card payments are not set up on this server yet, so a card can&apos;t be added.</p>;
  }
  if (loaded.state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" />
        Getting your hold ready…
      </div>
    );
  }
  if (loaded.state === "error") {
    return (
      <div className="mt-4 space-y-3">
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{loaded.message}</p>
        <Button type="button" variant="secondary" className="h-11 w-full rounded-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <Elements stripe={getStripe(publishableKey)} options={{ clientSecret: loaded.clientSecret, appearance: APPEARANCE }}>
      <PaymentForm groupId={groupId} planId={planId} amountText={amountText} testMode={isTestKey(publishableKey)} onPlaced={onPlaced} />
    </Elements>
  );
}

function PaymentForm({ groupId, planId, amountText, testMode, onPlaced }: { readonly groupId: string; readonly planId: string; readonly amountText: string; readonly testMode: boolean; readonly onPlaced: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // The card is confirmed on Stripe's side. This server never sees it, and only believes the result after asking Stripe itself.
      const result = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: window.location.href } });
      const outcome = outcomeOfCardEntry(result);
      if (outcome.kind === "error") return setMessage(outcome.message);
      if (outcome.kind === "unexpected") return setMessage("Something unexpected happened with the card. Please try again.");

      const confirmed = await confirmCardHold(groupId, planId);
      if (!confirmed.ok) return setMessage(confirmed.error);
      if (confirmed.outcome === "waiting" || outcome.kind === "processing") return setMessage("Your bank is still checking the card. This screen will update when it is done.");
      onPlaced();
    } catch {
      setMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {testMode ? <p className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground">{TEST_CARD_HINT}</p> : null}
      {message ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={!stripe || !elements || busy} className="h-12 w-full rounded-full text-base font-semibold">
        {busy ? <Loader2 className="size-5 animate-spin" /> : `Place hold · ${amountText}`}
      </Button>
      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Your card goes straight to Stripe. We never see it.
      </p>
    </form>
  );
}

"use client";

import { ChevronDown, Landmark } from "lucide-react";
import { useState } from "react";
import { isTestKey } from "@/lib/stripe-browser";
import { MONEY_STEPS, moneyExplainer } from "@/lib/money-copy";
import { cn } from "@/lib/utils";

/** Stripe's publishable key and the support address are public by design, and are read at build time. */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null;

interface MoneyExplainerProps {
  readonly amountMinor: number;
  readonly currency: string;
  /** Booking and holds are only pretended. */
  readonly demo?: boolean;
  readonly className?: string;
}

/**
 * Tells a person where their money is before they approve an amount, in plain words: three lines always shown, and a
 * "What is a hold?" line that opens the comparison, what their banking app will show, and a worked example.
 */
export function MoneyExplainer({ amountMinor, currency, demo = false, className }: MoneyExplainerProps) {
  const [open, setOpen] = useState(false);
  const text = moneyExplainer({ amountMinor, currency, supportEmail: SUPPORT_EMAIL, testMode: PUBLISHABLE_KEY !== null && isTestKey(PUBLISHABLE_KEY), demo });

  return (
    <section aria-label={text.heading} className={cn("space-y-3 rounded-xl border border-border bg-card px-4 py-3 text-sm", className)}>
      <h3 className="flex items-center gap-2 font-bold">
        <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {text.heading}
      </h3>

      <ol className="flex items-stretch gap-1 text-center text-[11px] leading-tight font-semibold" aria-label="The order things happen in">
        {MONEY_STEPS.map((step, index) => (
          <li key={step.when} className={cn("flex-1 rounded-lg px-1.5 py-1.5", index === 0 ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>
            <span className="block opacity-80">{step.when}</span>
            {step.what}
          </li>
        ))}
      </ol>

      {text.lead.map((line) => (
        <p key={line}>{line}</p>
      ))}

      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 items-center gap-1 font-semibold text-link">
        {text.toggle}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="space-y-2 text-muted-foreground">
          <p>{text.analogy}</p>
          <ul className="list-disc space-y-1.5 pl-5">
            {text.points.map((point) => (
              <li key={point.label}>
                <strong className="text-foreground">{point.label}:</strong> {point.text}
              </li>
            ))}
          </ul>
          <p>{text.goodToKnow}</p>
          {text.support ? <p>{text.support}</p> : null}
        </div>
      ) : null}

      {text.modeNote ? <p className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground">⚠ {text.modeNote}</p> : null}
    </section>
  );
}

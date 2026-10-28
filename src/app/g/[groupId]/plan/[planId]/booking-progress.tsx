import { Check, Circle, Loader2 } from "lucide-react";
import type { ProgressStepDto } from "@/domain/plan/view";
import { cn } from "@/lib/utils";

/**
 * The steps of booking the trip, with the one being worked on moving. It is there so the minute after the last card
 * is added does not look like nothing is happening, and it says the page can be closed because the chat is told.
 */
export function BookingProgress({ steps }: { readonly steps: readonly ProgressStepDto[] }) {
  return (
    <section aria-label="Booking progress" className="rounded-xl bg-card p-4 shadow-sm">
      <ol className="space-y-2.5">
        {steps.map((step) => (
          <li key={step.id} className={cn("flex items-center gap-3 text-sm", step.state === "waiting" && "text-muted-foreground")}>
            <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
              {step.state === "done" ? <Check className="size-5 text-success" /> : step.state === "active" ? <Loader2 className="size-5 animate-spin text-primary" /> : <Circle className="size-4 text-muted-foreground/50" />}
            </span>
            <span className={cn(step.state === "active" && "font-medium")}>{step.label}</span>
            <span className="sr-only">{step.state === "done" ? "done" : step.state === "active" ? "in progress" : "waiting"}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">You can close this page. We will post in the chat when it is done.</p>
    </section>
  );
}

import { CircleCheck } from "lucide-react";
import type { PlanViewDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";

/**
 * What the group sees once the trip is paid for: the code to quote, and what they were really charged. In the sandbox
 * nothing is booked with an airline or hotel, so it says so instead of pretending there are booking numbers.
 */
export function TripConfirmed({ view }: { readonly view: PlanViewDto }) {
  if (view.reference === null) return null;
  const mine = view.people.find((person) => person.isMe);
  const charged = mine?.chargedMinor ?? null;
  const released = charged !== null && mine?.approvedMinor != null && mine.approvedMinor > charged ? mine.approvedMinor - charged : 0;
  const where = [view.city, view.dates].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="confirmed-heading" className="space-y-3">
      <div className="rounded-xl bg-success/10 px-4 py-4 text-success">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CircleCheck className="size-5 shrink-0" aria-hidden />
          <span id="confirmed-heading">Trip confirmed</span>
        </p>
        {where ? <p className="mt-1 text-sm opacity-90">{where}</p> : null}
        <p className="mt-3 text-xs font-medium tracking-wide uppercase opacity-80">Reference</p>
        <p className="font-mono text-2xl font-semibold tracking-widest select-all">{view.reference}</p>
        <p className="mt-1 text-xs opacity-80">Quote this code to your group. It is this app&apos;s own reference, not an airline or hotel booking number.</p>
      </div>

      {view.demoBooking ? (
        <p role="note" className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
          Sandbox trip: no flights or hotel were really booked, so there are no airline or hotel booking numbers.
        </p>
      ) : null}

      {mine && charged !== null ? (
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground">Your receipt</h2>
          {mine.lines.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm">
              {mine.lines.map((line) => (
                <li key={line.label} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">{line.label}</span>
                  <span className="shrink-0">{formatMinor(line.minor, view.currency)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
            <span>Charged to your card</span>
            <span>{formatMinor(charged, mine.currency)}</span>
          </p>
          {released > 0 ? <p className="mt-1 text-xs text-muted-foreground">{formatMinor(released, mine.currency)} of your hold was let go, so you were not charged it.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

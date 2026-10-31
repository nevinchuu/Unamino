import { CalendarPlus, CircleCheck, FileText } from "lucide-react";
import Link from "next/link";
import { RetentionNotice } from "@/components/retention-notice";
import type { PlanViewDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";

/**
 * What the group sees once the trip is paid for: the code to quote, and what they were really charged. Booking codes from the
 * suppliers are shown when there are any; when booking is only pretended it says so instead of inventing booking numbers.
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

      {view.confirmations.length > 0 ? (
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground">Booking codes</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {view.confirmations.map((confirmation) => (
              <li key={`${confirmation.kind}-${confirmation.code}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-muted-foreground">
                  {confirmation.kind === "flight" ? "Flight" : "Hotel"} · {confirmation.title}
                </span>
                <span className="shrink-0 font-mono font-semibold select-all">{confirmation.code}</span>
              </li>
            ))}
          </ul>
          <p role="note" className="mt-3 text-xs text-muted-foreground">
            These come from the booking partner&apos;s sandbox, so they are test codes: nothing real was reserved.
          </p>
        </div>
      ) : null}

      {view.demoBooking ? (
        <p role="note" className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
          Sandbox trip: no flights or hotel were really booked, so there are no airline or hotel booking numbers.
        </p>
      ) : null}

      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-medium text-muted-foreground">Keep your trip</h2>
        <p className="mt-1 text-sm">Save a copy now. Your trip pack has the bookings, codes and your receipt on one page.</p>
        <div className="mt-3 flex flex-col gap-2">
          <Link href={`/g/${view.groupId}/plan/${view.id}/pack`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <FileText className="size-4" aria-hidden />
            Open your trip pack
          </Link>
          {view.tripDates.departDate || view.tripDates.returnDate ? (
            <a href={`/g/${view.groupId}/plan/${view.id}/pack/calendar`} download className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-foreground/30 px-4 text-sm font-semibold hover:bg-muted">
              <CalendarPlus className="size-4" aria-hidden />
              Add to calendar
            </a>
          ) : null}
        </div>
        <RetentionNotice keptUntil={view.keptUntil} className="mt-3 text-xs text-muted-foreground" />
      </div>

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
          {released > 0 ? <p className="mt-1 text-xs text-muted-foreground">{formatMinor(released, mine.currency)} of your hold was released, so you were not charged it. Your bank may take a few days to show that.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

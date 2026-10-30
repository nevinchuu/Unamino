import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AppBar, Screen } from "@/components/screen";
import { RetentionNotice } from "@/components/retention-notice";
import type { PlanViewDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";
import { planReference } from "@/lib/plan-reference";
import { itemLines } from "@/lib/trip-pack";
import { getContainer } from "@/server/container";
import { loadPlanViewFor } from "@/server/plan-view";
import { currentMember } from "@/server/session";
import { NotAMember } from "../../../not-a-member";
import { PrintButton } from "./print-button";

export default function TripPackPage({ params }: PageProps<"/g/[groupId]/plan/[planId]/pack">) {
  return (
    <Screen className="print:min-h-0 print:max-w-none print:border-0 print:bg-white">
      <Suspense fallback={<AppBar title="Trip pack" />}>
        <TripPack params={params} />
      </Suspense>
    </Screen>
  );
}

async function TripPack({ params }: { readonly params: PageProps<"/g/[groupId]/plan/[planId]/pack">["params"] }) {
  const { groupId, planId } = await params;
  if (!(await currentMember(groupId))) return <NotAMember />;

  const { views, payments } = getContainer();
  const loaded = await loadPlanViewFor({ views, memberOf: currentMember, payments: payments.mode, demoBooking: payments.demoBooking, scheduleRefresh: () => undefined }, planId);
  const planHref = `/g/${groupId}/plan/${planId}`;

  if (!loaded.ok || loaded.view.groupId !== groupId) return <Missing groupId={groupId} text="We couldn't find this trip." />;
  const { view } = loaded;
  if (view.status !== "booked" && view.status !== "captured") return <Missing groupId={groupId} text="Your trip pack is ready once the trip is booked." backHref={planHref} />;

  return (
    <>
      <div className="print:hidden">
        <AppBar title="Trip pack" subtitle={view.title} backHref={planHref} />
      </div>
      <main className="flex flex-1 flex-col gap-4 px-5 py-6 print:gap-3 print:px-0 print:py-0">
        <PackSheet view={view} />
        <div className="flex flex-col gap-2 print:hidden">
          <PrintButton />
          <p className="text-center text-xs text-muted-foreground">In the print window that opens, choose &quot;Save as PDF&quot; as the printer to keep a copy on your phone or computer.</p>
          {view.tripDates.departDate || view.tripDates.returnDate ? (
            <a href={`${planHref}/pack/calendar`} download className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-foreground/30 text-base font-semibold hover:bg-muted">
              <CalendarPlus className="size-5" aria-hidden />
              Add to calendar
            </a>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Missing({ groupId, text, backHref }: { readonly groupId: string; readonly text: string; readonly backHref?: string }) {
  return (
    <>
      <AppBar title="Trip pack" backHref={backHref ?? `/g/${groupId}`} />
      <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
        <h2 className="text-xl font-semibold">{text}</h2>
        <Link href={backHref ?? `/g/${groupId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          Back
        </Link>
      </main>
    </>
  );
}

/** The sheet itself: what to show at a hotel desk or an airport, on one page. */
function PackSheet({ view }: { readonly view: PlanViewDto }) {
  const mine = view.people.find((person) => person.isMe);
  const charged = mine?.chargedMinor ?? null;
  const where = [view.city, view.dates].filter(Boolean).join(" · ");
  const sections = [
    { heading: "Flights", items: view.items.filter((item) => item.kind === "flight") },
    { heading: "Hotel", items: view.items.filter((item) => item.kind === "hotel") },
    { heading: "Activities", items: view.items.filter((item) => item.kind === "activity") },
  ].filter((section) => section.items.length > 0);

  return (
    <article className="flex flex-col gap-4 print:gap-3">
      <header>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Trip pack</p>
        <h2 className="text-2xl font-extrabold">{view.title}</h2>
        {where ? <p className="text-sm text-muted-foreground">{where}</p> : null}
        <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference</p>
        <p className="font-mono text-xl font-semibold tracking-widest">{view.reference ?? planReference(view.id)}</p>
      </header>

      <section className="rounded-xl bg-card p-4 shadow-sm print:shadow-none print:ring-1 print:ring-border">
        <h3 className="text-sm font-medium text-muted-foreground">Who&apos;s going</h3>
        <p className="mt-1">{view.people.map((person) => person.name).join(", ")}</p>
      </section>

      {sections.map((section) => (
        <section key={section.heading} className="rounded-xl bg-card p-4 shadow-sm print:break-inside-avoid print:shadow-none print:ring-1 print:ring-border">
          <h3 className="text-sm font-medium text-muted-foreground">{section.heading}</h3>
          <ul className="mt-2 space-y-3">
            {section.items.map((item) => (
              <li key={item.id}>
                {itemLines(item).map((line, index) => (
                  <p key={`${item.id}-${line}`} className={index === 0 ? "font-semibold" : line.startsWith("Booking code:") ? "font-mono text-sm font-semibold" : "text-sm text-muted-foreground"}>
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {view.confirmations.length > 0 ? (
        <p role="note" className="text-xs text-muted-foreground">
          These booking codes come from the booking partner&apos;s sandbox, so they are test codes: nothing real was reserved.
        </p>
      ) : null}

      {mine && charged !== null ? (
        <section className="rounded-xl bg-card p-4 shadow-sm print:break-inside-avoid print:shadow-none print:ring-1 print:ring-border">
          <h3 className="text-sm font-medium text-muted-foreground">Your receipt</h3>
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
        </section>
      ) : null}

      <RetentionNotice keptUntil={view.keptUntil} />
    </article>
  );
}

import { Check, Clock, X } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import type { PersonDto, PlanViewDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";

/** Where one person stands, in the words of the step the plan is on. */
function progressOf(person: PersonDto, status: PlanViewDto["status"]): { readonly text: string; readonly icon: ReactNode; readonly good: boolean } {
  const tick = <Check className="size-3.5" />;
  const wait = <Clock className="size-3.5" />;
  const cross = <X className="size-3.5" />;

  if (status === "reviewing" || status === "draft") {
    if (person.agreement === "agreed") return { text: "Agreed", icon: tick, good: true };
    if (person.agreement === "declined") return { text: "Declined", icon: cross, good: false };
    return { text: "Hasn't agreed yet", icon: wait, good: false };
  }
  if (person.approval === "approved") return { text: person.holdPlaced ? "Approved · hold placed" : "Approved", icon: tick, good: true };
  if (person.approval === "needs_reapproval") return { text: "Needs to approve again", icon: wait, good: false };
  if (person.approval === "declined") return { text: "Declined", icon: cross, good: false };
  return { text: "Hasn't approved yet", icon: wait, good: false };
}

/** Everyone's amount and progress. Your own breaks down into its parts, and the total is shown when every share is in one currency. */
export function WhoPays({ people, status, currency }: { readonly people: readonly PersonDto[]; readonly status: PlanViewDto["status"]; readonly currency: string }) {
  const sameCurrency = people.every((person) => person.currency === currency && person.shareMinor !== null);
  const total = sameCurrency ? people.reduce((sum, person) => sum + (person.shareMinor ?? 0), 0) : null;

  return (
    <section aria-labelledby="who-pays-heading" className="rounded-xl bg-card p-2 shadow-sm">
      <h2 id="who-pays-heading" className="px-2 pt-2 text-sm font-medium text-muted-foreground">
        Who pays what
      </h2>
      <p className="px-2 pb-1 text-xs text-muted-foreground">Each share is the flights, your bed and only the things you take part in.</p>
      <ul>
        {people.map((person) => {
          const progress = progressOf(person, status);
          return (
            <li key={person.id} className="rounded-lg px-2 py-2">
              <div className="flex items-center gap-3">
                <Avatar name={person.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {person.name}
                    {person.isMe ? <span className="font-normal text-muted-foreground"> (You)</span> : null}
                  </p>
                  <p className={`flex items-center gap-1 text-xs ${progress.good ? "text-success" : "text-muted-foreground"}`}>
                    {progress.icon}
                    {progress.text}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">{person.shareMinor === null ? "…" : formatMinor(person.shareMinor, person.currency)}</p>
              </div>
              {person.isMe && person.lines.length > 0 ? (
                <ul className="mt-2 ml-12 space-y-0.5 text-xs text-muted-foreground">
                  {person.lines.map((line) => (
                    <li key={line.label} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{line.label}</span>
                      <span className="shrink-0">{formatMinor(line.minor, currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {total !== null ? (
        <p className="flex justify-between border-t border-border px-2 pt-2 pb-1 text-sm">
          <span className="text-muted-foreground">Trip total</span>
          <span className="font-semibold">{formatMinor(total, currency)}</span>
        </p>
      ) : null}
    </section>
  );
}

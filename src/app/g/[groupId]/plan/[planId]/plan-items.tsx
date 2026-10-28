import { BedDouble, MapPin, Plane, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import type { IdeaDto, PlanItemDto } from "@/domain/plan/view";
import { formatMinor } from "@/lib/format-money";

/** Flights and hotels come only from a test sandbox, so their cards say so: nobody should take the prices for real ones. */
function SandboxTag() {
  return <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Sandbox listing</span>;
}

function Card({ icon, title, subtitle, price, sandbox = false, children }: { readonly icon: ReactNode; readonly title: string; readonly subtitle?: string; readonly price?: ReactNode; readonly sandbox?: boolean; readonly children?: ReactNode }) {
  return (
    <article className="rounded-xl bg-card p-4 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold break-words">{title}</h3>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {price ? (
          <div className="shrink-0 text-right">
            {price}
            {sandbox ? <SandboxTag /> : null}
          </div>
        ) : null}
      </header>
      {children}
    </article>
  );
}

const DIRECTION_LABEL = { outbound: "Going", inbound: "Coming back" } as const;

function Who({ names }: { readonly names: readonly string[] }) {
  return (
    <p className="mt-3 text-sm">
      <span className="text-muted-foreground">For </span>
      <span className="font-medium">{names.join(", ")}</span>
    </p>
  );
}

function Why({ reason, notes }: { readonly reason: string; readonly notes: readonly { readonly name: string; readonly text: string }[] }) {
  return (
    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
      <p>{reason}</p>
      {notes.map((note) => (
        <p key={`${note.name}-${note.text}`}>
          <span className="font-medium text-foreground">{note.name}:</span> {note.text}
        </p>
      ))}
    </div>
  );
}

/** One thing the plan buys: a flight, a stay or an activity, with who it is for and why it was chosen. */
export function ItemCard({ item }: { readonly item: PlanItemDto }) {
  const price = (
    <>
      <p className="font-semibold">{formatMinor(item.totalMinor, item.currency)}</p>
      <p className="text-xs text-muted-foreground">for {item.memberNames.length === 1 ? "1 person" : `${item.memberNames.length} people`}</p>
    </>
  );

  if (item.kind === "flight") {
    return (
      <Card icon={<Plane className="size-5" />} title={item.title} subtitle={item.refundable ? "Refundable" : "Not refundable"} price={price} sandbox>
        <ul className="mt-3 space-y-2">
          {item.legs.map((leg, index) => (
            <li key={index} className="rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="font-medium">
                {DIRECTION_LABEL[leg.direction]} · {leg.route}
              </p>
              <p className="text-muted-foreground">
                {leg.departs} → {leg.arrives}
              </p>
              <p className="text-muted-foreground">{leg.carrier}</p>
            </li>
          ))}
        </ul>
        <Who names={item.memberNames} />
        <Why reason={item.reason} notes={item.notes} />
      </Card>
    );
  }

  if (item.kind === "hotel") {
    return (
      <Card icon={<BedDouble className="size-5" />} title={item.title} subtitle={`${item.roomName}${item.stars ? ` · ${"★".repeat(item.stars)}` : ""}`} price={price} sandbox>
        <p className="mt-3 text-sm">{item.stay}</p>
        {item.freeCancellationUntil ? <p className="mt-1 text-sm font-medium text-success">Free cancellation until {item.freeCancellationUntil}</p> : <p className="mt-1 text-sm text-muted-foreground">No free cancellation</p>}
        {item.extraCharges.map((charge) => (
          <p key={charge.description} className="mt-1 text-sm text-muted-foreground">
            Paid at the hotel: {charge.description}, {formatMinor(charge.minor, charge.currency)}
          </p>
        ))}
        <Who names={item.memberNames} />
        <Why reason={item.reason} notes={item.notes} />
      </Card>
    );
  }

  return (
    <Card icon={<Ticket className="size-5" />} title={item.title} subtitle={item.when} price={price}>
      <Who names={item.memberNames} />
      <Why reason={item.reason} notes={item.notes} />
    </Card>
  );
}

/** A place to go in the free time. Everything shown about it comes from Google. */
export function IdeaCard({ idea }: { readonly idea: IdeaDto }) {
  return (
    <article className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold break-words">
            {idea.mapsUrl ? (
              <a href={idea.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                {idea.name}
              </a>
            ) : (
              idea.name
            )}
          </h3>
          <p className="text-sm text-muted-foreground">{idea.when}</p>
          {idea.address ? <p className="text-sm text-muted-foreground">{idea.address}</p> : null}
          <p className="mt-1 text-sm">{idea.why}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{idea.category}</span>
      </div>
    </article>
  );
}

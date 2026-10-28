import Link from "next/link";
import { AvatarStack } from "@/components/avatar";
import { StatusChip } from "@/components/status-chip";
import { avatarColour, initialsOf } from "@/lib/avatar";
import { relativeTime } from "@/lib/trip-list";
import { cn } from "@/lib/utils";
import type { TripDto } from "@/server/trips";

/** A tile with the trip's initials on a gradient made from its name, standing in for a photo. */
function TripTile({ name }: { readonly name: string }) {
  const second = avatarColour(Array.from(name).reverse().join(""));
  const first = avatarColour(name);
  return (
    <span
      aria-hidden="true"
      className="flex size-[68px] shrink-0 items-end rounded-2xl p-2 text-[13px] font-extrabold text-white"
      style={{ backgroundImage: `linear-gradient(135deg, ${first}, ${second === first ? "#0E1B3D" : second})` }}
    >
      {initialsOf(name).slice(0, 2)}
    </span>
  );
}

/** One group on the trips list: its name, the last message, who has done their part, and how the plan stands. */
export function TripCard({ trip, now }: { readonly trip: TripDto; readonly now: Date }) {
  return (
    <Link href={`/g/${trip.groupId}`} className="flex gap-3.5 rounded-[22px] bg-card p-3.5 shadow-soft transition-transform active:scale-[0.99]">
      <TripTile name={trip.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{trip.name}</span>
          {trip.at ? <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(trip.at), now)}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", trip.unread ? "font-bold" : "text-foreground")}>{trip.preview ?? "No messages yet"}</span>
          {trip.unread ? (
            <>
              <span className="size-2.5 shrink-0 rounded-full bg-unread" aria-hidden="true" />
              <span className="sr-only">Unread</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <AvatarStack people={trip.people.map((person) => ({ name: person.name, dot: person.done }))} max={4} size={26} />
          {trip.status ? <StatusChip tone={trip.status.tone}>{trip.status.label}</StatusChip> : null}
        </div>
      </div>
    </Link>
  );
}

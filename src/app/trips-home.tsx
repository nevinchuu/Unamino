import { Plus } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getContainer } from "@/server/container";
import { membershipsFromCookies } from "@/server/member-cookie";
import { loadTrips } from "@/server/trips";
import { TripCard } from "./trip-card";
import { TripMenu } from "./trip-menu";

/** The title row, drawn straight away while the list itself is still being read. */
export function TripsHeader() {
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-9 pb-2">
        <h1 className="text-[32px] leading-none font-extrabold tracking-tight">Trips</h1>
        <Link href="/new" aria-label="New trip" className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform active:scale-95">
          <Plus className="size-6" />
        </Link>
      </div>
      <p className="px-5 text-sm text-muted-foreground">Who&apos;s in, and what is still open, across your groups.</p>
    </>
  );
}

/** Every group this browser is a member of, newest activity first. A browser with none goes straight to making one. */
export async function TripsHome() {
  const trips = await loadTrips(getContainer().trips, membershipsFromCookies((await cookies()).getAll()));
  if (trips.length === 0) redirect("/new");

  const now = new Date();
  return (
    <>
      <TripsHeader />
      <ul className="flex flex-col gap-3.5 px-4 pt-5 pb-8">
        {trips.map((trip) => (
          <li key={trip.groupId} className="relative">
            <TripCard trip={trip} now={now} />
            <TripMenu groupId={trip.groupId} name={trip.name} isAdmin={trip.isAdmin} />
          </li>
        ))}
      </ul>
    </>
  );
}

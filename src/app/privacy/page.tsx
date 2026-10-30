import Link from "next/link";
import { AppBar, Screen } from "@/components/screen";
import { RETENTION } from "@/domain/retention/policy";

export const metadata = { title: "Privacy notice" };

/**
 * What the app collects and how long it keeps it. The periods come from the same constants the deletion job uses, so this
 * page cannot promise something the code does not do.
 */
export default function PrivacyPage() {
  return (
    <Screen>
      <AppBar title="Privacy notice" backHref="/" />
      <main className="flex flex-1 flex-col gap-5 px-5 py-6 text-sm leading-6">
        <p className="text-muted-foreground">
          Unamino helps a group plan a trip together, agree to it, and pay for it only when everyone is in. This notice says what we keep about you, why, and for how long.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-bold">What we keep, and why</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Your name and the group chat.</strong> So the group can talk and Trippy can plan with you.
            </li>
            <li>
              <strong>The plan and what you agreed to pay.</strong> So everyone sees the same price and nobody is charged more than they approved.
            </li>
            <li>
              <strong>Traveller details</strong> (name as on your passport, date of birth, nationality, email, phone and, for flights, passport details). Only to make the booking. They are stored encrypted, never shown to the group or to the AI, and deleted as soon as the trip is booked or the plan ends, and always within 72 hours.
            </li>
            <li>
              <strong>Your card.</strong> We never see or store it. Our payment provider, Stripe, holds it for the amount you approve and charges it only when every booking is made.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">How long we keep it</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>A booked trip:</strong> the chat, plans and booking details are deleted {RETENTION.daysAfterTrip} days after the trip ends. The confirmation screen shows the exact day, and lets you save a trip pack (a printable page and a calendar file) first.
            </li>
            <li>
              <strong>A group that never booked:</strong> deleted after {RETENTION.daysInactive} days without a message.
            </li>
            <li>
              <strong>A small record of each payment:</strong> kept for about {Math.round(RETENTION.recordDaysAfterTrip / 30)} months after the trip, so we can answer a card dispute. It holds the trip reference, the payer&apos;s name, what they approved and were charged, the payment id and the hotel and airline booking ids. It holds no chat, no email, no phone and no passport details.
            </li>
            <li>
              <strong>Sooner, if you ask:</strong> the group admin can delete the whole group at any time from Group info, which deletes everything above except the payment record. You can also exit a group yourself.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">Who else handles your data</h2>
          <p>
            Supabase (database), Vercel (hosting), Stripe (card holds and payments), liteAPI by Nuitee (hotel and flight bookings), Meta (the Muse Spark model that reads the chat to plan) and Google (free-time ideas). Each receives only what its job needs and applies its own terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">Your choices</h2>
          <p>
            You can leave a group at any time, or ask the group admin to delete it. To ask what we hold about you, or to have it corrected or deleted, contact the project owner by opening an issue on the project&apos;s repository, github.com/nevinchuu/Unamino. This is a hackathon project running against sandbox bookings, so nothing real is booked and no real card is charged.
          </p>
        </section>

        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          Back to your trips
        </Link>
      </main>
    </Screen>
  );
}

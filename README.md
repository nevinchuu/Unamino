# Unamino

**Book a group trip only when everyone is in.** Friends plan in a group chat with an agent called Trippy, built on Meta's Muse Spark. Trippy finds real flights and hotels and proposes a plan. Each person then approves their own capped amount and puts a card **hold** on it. Only when everyone is in are the flights and hotel booked, and only then are the holds charged. If anything fails, the bookings are cancelled and every hold is released. Nobody pays for a trip that did not happen.

The interesting part is not the itinerary. It is the commitment engine behind it: per-person splits, capped holds, and an all-or-nothing booking with a rollback.

Built for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

> **Everything here runs on test data.** Flights and hotels come from the liteAPI sandbox, and cards are in Stripe test mode. No real booking is made and no real money moves. See [Sandbox and test mode](#sandbox-and-test-mode).

## What was written during the hackathon

Everything in this repository was written during the event: the first commit is dated 27 October 2026. Open-source dependencies are listed in `package.json`.

## How it works

1. Someone creates a group and shares one invite link. Everyone chats normally.
2. Anyone mentions `@trippy` (or replies to it). Trippy decides for itself what to do: brainstorm, ask one question, or search and propose a plan.
3. **Step 1, agree.** Everyone looks at the plan and agrees. No card yet. A person can also tap **I need changes**, which asks Trippy to adjust the plan instead of ending it.
4. **Step 2, approve.** Each person approves *their own* amount (a cap), gives traveller details, and adds a card. This places a **hold**, not a charge.
5. **Booking.** When the last hold lands, the hotel and then the flight are booked. Only then is each person charged their share, which can be lower than their cap and never higher.
6. **If anything fails** (a price rises past someone's cap, a flight sells out, the clock runs out), every booking made so far is cancelled and every hold is released.

Each person pays only for what they take part in: a friend who already lives at the destination pays for the hotel, not a flight.

### The rules the code enforces

- **Nobody is charged unless everyone is in.** A pure state machine (`src/domain/plan/transition.ts`) decides every step.
- **The cap rule.** A charge can never exceed what the person approved. It is checked in four places: the state machine, the hold service, a database constraint, and Stripe itself.
- **Book first, charge last.** Cards are charged only after the suppliers confirm.
- **A price rise of more than 5%** sends everyone back to agree again. A smaller rise only shows a note.
- **Passport details** are encrypted (AES-256-GCM) and deleted as soon as the trip is booked or the plan ends.
- **Overlapping trips are refused.** A group cannot plan dates that clash with a trip it has booked.

## How Muse Spark is used

Muse Spark is the agent's brain, not a text generator bolted on.

- **A reasoning loop with native tool calling** (`src/domain/agent/loop/conversation.ts`). The model takes up to 8 turns. A turn with no tool call is its reply. Text beside a tool call becomes a short status line in the chat.
- **Two tools** (`tools.ts`, `propose-plan.ts`): `search_trip` looks up flights and hotels, and `propose_plan` puts a plan in front of the group. The model chooses between them, or none, from what people say. It can ask one question, brainstorm, or search.
- **It reasons about who needs what.** `search_trip` takes a `flyers` list, so a friend who is already there gets a room and no flight, and flights are priced only for the people who fly.
- **Structured calls** extract each person's limits from the chat (budget caps, flight windows, own room) and suggest things to do in the free time, which are checked against Google Places opening hours.
- **The model proposes, the code decides.** Picks are validated against the real offers that a search returned, every person's share is computed by code, and a proposal that does not cover everyone is rejected. `grounding.ts` removes any dollar amount in a reply that did not come from a search result or from the chat.
- **System prompt:** `src/domain/agent/loop/prompt.ts`. Model client: `src/infrastructure/muse/`. Default model `muse-spark-1.3` through the Meta Model API.

Setting `MUSE_TRACE=1` in development writes every model call and every agent step to `.muse-trace/trace.jsonl`, so a turn can be read back step by step.

## Sandbox and test mode

| Part | What it really is |
|---|---|
| Flights and hotels | [liteAPI](https://docs.liteapi.travel/) **sandbox**. Prices and availability are test data. Bookings are made with the sandbox account credit. |
| Booking codes | Test codes from the sandbox, labelled as such on the confirmation screen. Plan cards carry a "Sandbox listing" tag. |
| Cards | **Stripe test mode.** Use `4242 4242 4242 4242`, any future expiry, any CVC. Holds are manual-capture PaymentIntents. |
| Currency | USD only. |
| Phuket | The sandbox has no hotels there. Use Bangkok. |

## Try it

You need Node 24 and pnpm 12, and your own accounts for the services below. All of them have free or test tiers.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | A Postgres database. It was built on Supabase (use the session pooler, port 5432, locally). |
| `MUSE_SPARK_API_KEY` | Meta Model API key for Muse Spark. |
| `LITEAPI_KEY` | liteAPI **sandbox** key. |
| `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** keys. |
| `TRAVELLER_ENCRYPTION_KEY` | A 32-byte base64 key: `openssl rand -base64 32`. |
| `CRON_SECRET` | Any long random string. Protects the scheduled routes. |
| `GOOGLE_PLACES_API_KEY` | Optional. Without it, free-time ideas are skipped. |

```bash
pnpm install
cp .env.example .env.local      # then fill in the values above
pnpm db:migrate                 # creates the tables
pnpm dev                        # http://localhost:3000
```

`SIMULATE_HOLDS` and `SIMULATE_BOOKING` in `.env.example` are development shortcuts. The server refuses to start with either set in production. Leave them empty to see the real flow.

### A walkthrough with two people

The flow needs more than one person, and one browser can be two people:

1. Open `http://localhost:3000`, create a group, and enter your name.
2. Open the group's info page and copy the invite link.
3. Open that link in a **private window**, or swap `localhost` for `127.0.0.1` in the address bar. Each gets its own identity. Enter a second name.
4. In the chat, write something like: `@trippy we are two friends flying from Singapore to Bangkok, 11 to 13 Dec 2026, about $300 each`. Use dates a few weeks ahead. Planning takes 30 to 40 seconds.
5. Both people tap **Agree**, then **Approve**, then fill in the traveller details (made-up values; a passport is asked for only from someone on a flight) and the test card.
6. Watch the progress list: hotel, flight, charge. The chat posts "Booked", and the confirmation shows the booking codes and each person's receipt.

To see the rollback, back out as one person before the last hold lands: every hold is released and nobody is charged.

Optionally run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`. The app works without it, because the plan screen confirms holds itself.

### Tests

```bash
pnpm test        # over 1,200 tests
pnpm typecheck
pnpm lint
```

Tests that call real services (Muse, Stripe, liteAPI, the database) are opt-in and skipped by default. Their commands are in the header of each `*.live.test.ts` and `*.db.test.ts` file.

## Where things are

| Path | What it holds |
|---|---|
| `src/domain/agent/` | The Muse agent: loop, prompt, tools, grounding |
| `src/domain/plan/` | The plan state machine, pricing, refresh, view |
| `src/domain/split/` | Per-person cost splitting |
| `src/domain/payments/` | Card holds, charging, retries |
| `src/domain/booking/` | Booking runner, cancel-on-failure, stuck-booking sweeper |
| `src/domain/travellers/` | Encrypted traveller details |
| `src/infrastructure/` | Muse, liteAPI, Stripe, Google Places, Postgres |
| `src/app/` | The mobile web app and its API routes |

## Known limits

- Sandbox and test mode only, as described above.
- Everyone pays in USD.
- Anyone in a group can end a plan for everyone, though **I need changes** offers a softer route.
- The scheduled routes (`/api/cron/expire-overdue`, `/api/cron/retry-effects`) need a scheduler and `CRON_SECRET`. They are not scheduled locally.
- Security headers are partial: there is no script policy yet.

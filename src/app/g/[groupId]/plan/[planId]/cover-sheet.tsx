"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { StickyFooter } from "@/components/sticky-footer";
import { Button } from "@/components/ui/button";
import type { PlanViewDto } from "@/domain/plan/view";
import { coverAmount, coverChangeFor, coverNotice, coverTargets, parseMoney, type CoverMode } from "@/lib/cover-choice";
import { formatMinor } from "@/lib/format-money";
import { cn } from "@/lib/utils";
import { coverShare } from "./actions";

interface CoverSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: PlanViewDto;
  /** Called once the change is in, with a line for the notice at the top of the plan. */
  readonly onDone: (text: string) => void;
}

const MODES: readonly { readonly mode: CoverMode; readonly label: string }[] = [
  { mode: "all", label: "All of it" },
  { mode: "half", label: "Half" },
  { mode: "custom", label: "An amount" },
];

/**
 * Pick a friend and how much of their share you will pay. "Half" and "All of it" follow the price if it moves, while an
 * amount stays what you said. The friend still agrees, approves and gives their details like everyone else.
 */
export function CoverSheet({ open, onOpenChange, view, onDone }: CoverSheetProps) {
  const [friendId, setFriendId] = useState<string | null>(null);
  const [mode, setMode] = useState<CoverMode>("half");
  const [customText, setCustomText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = coverTargets(view.people, view.covers);
  const me = view.people.find((person) => person.isMe);
  const target = targets.find((candidate) => candidate.person.id === friendId && candidate.blockedReason === null) ?? null;
  const customMinor = parseMoney(customText, view.currency);
  const change = coverChangeFor(mode, customMinor);
  const ownPart = target?.person.ownPartMinor ?? 0;
  const amount = target ? coverAmount(mode, ownPart, target.othersCoverMinor, customMinor) : 0;
  const left = target ? Math.max(0, ownPart - target.othersCoverMinor) : 0;
  const alreadyMine = target?.person.coveredByMe ?? null;
  const tooMuch = mode === "custom" && customMinor !== null && target !== null && customMinor > left;
  // Only worth predicting in the plan's own currency, where the numbers add up.
  const myNewShare = me && me.shareMinor !== null && me.currency === view.currency && target ? me.shareMinor - (alreadyMine?.amountMinor ?? 0) + amount : null;
  const theirNewShare = target && target.person.shareMinor !== null && target.person.currency === view.currency ? target.person.shareMinor + (alreadyMine?.amountMinor ?? 0) - amount : null;

  async function send(request: NonNullable<typeof change> | { readonly kind: "stop" }) {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await coverShare(view.groupId, view.id, target.person.id, request);
      if (!result.ok) return setError(result.error);
      const text = result.outcome === "unchanged" ? `Nothing changed: it was already like that.` : coverNotice(request, target.person.name, formatMinor(amount, view.currency));
      setFriendId(null);
      setCustomText("");
      onDone(text);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const blockedAll = targets.length > 0 && targets.every((candidate) => candidate.blockedReason !== null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Cover a friend&apos;s share</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">You pay part of their share. They still agree, approve and give their details.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-3 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div role="radiogroup" aria-label="Who to cover" className="mt-4 space-y-1.5">
            {targets.map(({ person, blockedReason, othersCoverMinor }) => {
              const chosen = friendId === person.id && blockedReason === null;
              return (
                <button
                  key={person.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={blockedReason !== null}
                  onClick={() => {
                    setFriendId(person.id);
                    setError(null);
                  }}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    chosen ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted",
                    blockedReason !== null && "opacity-60 hover:bg-background",
                  )}
                >
                  <Avatar name={person.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {blockedReason ??
                        (person.ownPartMinor === null
                          ? ""
                          : othersCoverMinor > 0
                            ? `Their share ${formatMinor(person.ownPartMinor, view.currency)} · ${formatMinor(othersCoverMinor, view.currency)} already covered`
                            : `Their share ${formatMinor(person.ownPartMinor, view.currency)}`)}
                    </span>
                  </span>
                  {person.coveredByMe ? <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">You cover</span> : null}
                </button>
              );
            })}
          </div>

          {blockedAll ? <p className="mt-3 text-sm text-muted-foreground">Nobody can be covered right now.</p> : null}

          {target ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground">How much of {target.person.name}&apos;s share?</p>
              <div role="radiogroup" aria-label="How much to cover" className="mt-2 flex flex-wrap gap-2">
                {MODES.map((choice) => (
                  <button
                    key={choice.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === choice.mode}
                    onClick={() => setMode(choice.mode)}
                    className={cn("min-h-11 rounded-full border px-4 text-sm font-medium transition-colors", mode === choice.mode ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>

              {mode === "custom" ? (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-muted-foreground" htmlFor="cover-amount">
                    Amount in {view.currency}
                  </label>
                  <input
                    id="cover-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={customText}
                    onChange={(event) => setCustomText(event.target.value)}
                    placeholder="25.00"
                    className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-primary"
                  />
                  {customText !== "" && customMinor === null ? <p className="mt-1 text-xs text-destructive">Enter an amount above zero, like 25 or 25.50.</p> : null}
                  {tooMuch ? <p className="mt-1 text-xs text-destructive">That&apos;s more than what&apos;s left of their share, {formatMinor(left, view.currency)}.</p> : null}
                </div>
              ) : null}

              <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
                {amount > 0 ? (
                  <>
                    You&apos;d pay <strong>{formatMinor(amount, view.currency)}</strong> of {target.person.name}&apos;s share
                    {myNewShare !== null ? <>, making yours {formatMinor(myNewShare, view.currency)}</> : null}.{" "}
                    {theirNewShare !== null ? <>{target.person.name} would pay {theirNewShare === 0 ? "nothing" : formatMinor(theirNewShare, view.currency)}.</> : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Choose how much to cover.</span>
                )}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {mode === "custom" ? "A set amount stays the same if prices move." : "This follows the price if it moves."} Changing who pays sends everyone back to agree again, and {target.person.name} still approves their own part.
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {target ? (
            <StickyFooter>
              <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" disabled={busy || change === null || amount <= 0 || tooMuch} onClick={() => change && void send(change)}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : amount > 0 ? `Cover ${formatMinor(amount, view.currency)} for ${target.person.name}` : "Cover"}
              </Button>
              {alreadyMine ? (
                <button type="button" disabled={busy} onClick={() => void send({ kind: "stop" })} className="mx-auto block min-h-11 px-3 text-sm font-medium text-muted-foreground underline underline-offset-2">
                  Stop covering {target.person.name}
                </button>
              ) : null}
            </StickyFooter>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

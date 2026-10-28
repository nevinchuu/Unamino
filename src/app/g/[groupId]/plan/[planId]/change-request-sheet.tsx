"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CHANGE_REASONS, NOTE_MAX, type ChangeReason } from "@/lib/change-request";
import { cn } from "@/lib/utils";
import { requestPlanChanges } from "./actions";

const LABELS: Readonly<Record<ChangeReason, string>> = {
  too_expensive: "Too expensive for me",
  different_dates: "Different dates",
  different_pick: "Different flight or hotel",
  other: "Something else",
};

interface ChangeRequestSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groupId: string;
  readonly planId: string;
  /** Called once Trippy has the request, with whether it could start working on it right away. */
  readonly onSent: (asked: boolean) => void;
}

/** A small sheet to say what needs to change. The plan stays alive: Trippy answers in the chat with an adjusted one. */
export function ChangeRequestSheet({ open, onOpenChange, groupId, planId, onSent }: ChangeRequestSheetProps) {
  const [reason, setReason] = useState<ChangeReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPlanChanges(groupId, planId, reason, note);
      if (!result.ok) return setError(result.error);
      setReason(null);
      setNote("");
      onSent(result.asked);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">What needs to change?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">Trippy will adjust the plan and post it in the chat. Nothing ends, and nobody is charged.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-3 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div role="radiogroup" aria-label="What needs to change" className="mt-4 flex flex-wrap gap-2">
            {CHANGE_REASONS.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={reason === choice}
                onClick={() => setReason(choice)}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium transition-colors", reason === choice ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}
              >
                {LABELS[choice]}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="change-note">
            Anything Trippy should know? (optional)
          </label>
          <textarea
            id="change-note"
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: under $200 for me, or leave a day later"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
          />
          <p className="text-right text-xs text-muted-foreground">
            {note.length}/{NOTE_MAX}
          </p>

          {error ? (
            <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="button" className="mt-3 h-12 w-full rounded-full text-base font-semibold" disabled={!reason || busy} onClick={() => void send()}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : "Send to Trippy"}
          </Button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

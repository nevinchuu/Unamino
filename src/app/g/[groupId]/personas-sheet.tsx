"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, FlaskConical, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PersonaChoice } from "@/domain/persona/service";
import { cn } from "@/lib/utils";
import { addPersonas, loadPersonaChoices } from "./actions";

interface PersonasSheetProps {
  readonly groupId: string;
}

/** A button beside the group's people that adds simulated friends, so a judge can try a group trip alone. */
export function PersonasSheet({ groupId }: PersonasSheetProps) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<readonly PersonaChoice[] | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Looks again each time the sheet opens, because people may have been added since.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    loadPersonaChoices(groupId)
      .then((result) => {
        if (stale) return;
        if (result.ok) {
          setChoices(result.choices);
          setError(null);
        } else setError(result.error);
      })
      .catch(() => {
        if (!stale) setError("Couldn't reach the server. Check your connection and try again.");
      });
    return () => {
      stale = true;
    };
  }, [open, groupId]);

  const toggle = (key: string) => setPicked((held) => (held.includes(key) ? held.filter((candidate) => candidate !== key) : [...held, key]));

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await addPersonas(groupId, picked);
      if (!result.ok) return setError(result.error);
      setPicked([]);
      setOpen(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger aria-label="Add test personas" className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
        <FlaskConical className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add test friends</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Simulated people with their own limits. They chat, agree and approve like real friends, for the hotel only, and never fly. Card holds use Stripe&apos;s test mode.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-3 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {(choices ?? []).map((choice) => {
              const on = choice.added || picked.includes(choice.key);
              return (
                <li key={choice.key}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={choice.added}
                    onClick={() => toggle(choice.key)}
                    className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-2 text-left transition-colors", on ? "border-primary bg-primary/5" : "border-border hover:bg-muted", choice.added && "opacity-70")}
                  >
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{on ? <Check className="size-4" /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{choice.name}</span>
                      <span className="block text-sm text-muted-foreground">{choice.added ? "Already in this group" : choice.tagline}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {choices === null && !error ? <Loader2 className="mx-auto mt-4 size-5 animate-spin text-muted-foreground" aria-label="Loading" /> : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="button" className="mt-4 h-12 w-full rounded-full text-base font-semibold" disabled={picked.length === 0 || busy} onClick={() => void add()}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : picked.length === 0 ? "Pick who to add" : `Add ${picked.length}`}
          </Button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

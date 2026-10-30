"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** Red for something that cannot be undone. */
  readonly destructive?: boolean;
  /** Extra choices or a field, shown between the description and the button. */
  readonly children?: ReactNode;
  /** The button stays off until this is true, e.g. until a name has been typed. */
  readonly ready?: boolean;
  /** Does the thing. Returns a message to show when it did not work, or null when it did. */
  readonly onConfirm: () => Promise<string | null>;
}

/** A bottom sheet that asks "are you sure?" before something people cannot take back, and shows the reason when it is refused. */
export function ConfirmSheet({ open, onOpenChange, title, description, confirmLabel, destructive = false, children, ready = true, onConfirm }: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const problem = await onConfirm();
      if (problem) return setError(problem);
      onOpenChange(false);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-3 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          {children ? <div className="mt-4">{children}</div> : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button type="button" variant="secondary" className="h-12 flex-1 rounded-full" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant={destructive ? "destructive" : "default"} className="h-12 flex-1 rounded-full text-base font-semibold" disabled={busy || !ready} onClick={() => void confirm()}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

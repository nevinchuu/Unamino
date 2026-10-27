"use client";

import { Check, Copy, Link2, Loader2, Share2 } from "lucide-react";
import { useActionState, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/server/forms";
import { resetInviteLink } from "./actions";

const INITIAL: FormState = {};
const subscribeToNothing = () => () => undefined;

/** The address of this site, known only in the browser. It is empty while the page is being drawn on the server. */
const useOrigin = (): string => useSyncExternalStore(subscribeToNothing, () => window.location.origin, () => "");
const useCanShare = (): boolean => useSyncExternalStore(subscribeToNothing, () => typeof navigator.share === "function", () => false);

interface InvitePanelProps {
  readonly groupId: string;
  readonly groupName: string;
  /** `/join/<secret>`, or null once the hour in which the secret can be shown has passed. */
  readonly joinPath: string | null;
}

export function InvitePanel({ groupId, groupName, joinPath }: InvitePanelProps) {
  const [state, formAction, pending] = useActionState(resetInviteLink.bind(null, groupId), INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const origin = useOrigin();
  const canShare = useCanShare();
  const link = joinPath && origin ? `${origin}${joinPath}` : null;

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2000);
    } catch {
      // Some browsers refuse clipboard access; the link is on screen to be selected by hand.
      setCopy("failed");
    }
  }

  async function shareLink() {
    if (!link) return;
    try {
      await navigator.share({ title: groupName, text: `Join ${groupName} on Unamino`, url: link });
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  return (
    <section aria-labelledby="invite-heading" className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-success text-white">
          <Link2 className="size-5" />
        </span>
        <div>
          <h2 id="invite-heading" className="font-semibold">
            Invite to group via link
          </h2>
          <p className="text-sm text-muted-foreground">Anyone with the link can join, up to 12 people.</p>
        </div>
      </div>

      {link ? (
        <>
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm break-all select-all">{link}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="secondary" onClick={copyLink} className="h-10 flex-1 rounded-full">
              {copy === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copy === "copied" ? "Copied" : "Copy link"}
            </Button>
            {canShare ? (
              <Button type="button" onClick={shareLink} className="h-10 flex-1 rounded-full">
                <Share2 className="size-4" />
                Share
              </Button>
            ) : null}
          </div>
          {copy === "failed" ? <p className="mt-2 text-xs text-muted-foreground">Couldn&apos;t copy automatically. Press and hold the link to copy it.</p> : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">For safety the link is only shown for an hour after it is made. Make a new one to share it again.</p>
      )}

      {state.message ? (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <form action={formAction} onSubmit={() => setConfirming(false)} className="mt-3">
        {confirming ? (
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
            <p>The link you shared before will stop working. Make a new one?</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} className="h-9 flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="h-9 flex-1">
                {pending ? <Loader2 className="size-4 animate-spin" /> : "Make new link"}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-primary">
            {link ? "Reset link" : "Make a new link"}
          </button>
        )}
      </form>
    </section>
  );
}

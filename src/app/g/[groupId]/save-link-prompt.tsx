"use client";

import { KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

const keyFor = (groupId: string): string => `unamino:save-link:${groupId}`;
const subscribeToNothing = () => () => undefined;

/** Has this browser already been asked about this group? Anything that stops the answer being read counts as yes, so nobody is nagged. */
function alreadyAsked(groupId: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(groupId)) === "1";
  } catch {
    return true;
  }
}

/**
 * A slim bar at the top of the chat, once per browser and group: save your access link now, because without one a lost
 * phone or a cleared browser leaves nobody who can bring you back. It sends you to the place that makes it.
 */
export function SaveLinkPrompt({ groupId }: { readonly groupId: string }) {
  const asked = useSyncExternalStore(subscribeToNothing, () => alreadyAsked(groupId), () => true);
  const [dismissed, setDismissed] = useState(false);
  if (asked || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(keyFor(groupId), "1");
    } catch {
      // Without storage the bar comes back next time, which is better than losing the reminder.
    }
  };

  return (
    <div role="region" aria-label="Save your access link" className="flex items-center gap-2 border-b border-border bg-card pr-1 pl-4 text-[13px]">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 py-2 leading-4">Save your access link to get back in if you switch phones.</p>
      <Link href={`/g/${groupId}/info#access`} onClick={dismiss} className="inline-flex min-h-11 items-center px-2 font-semibold text-link">
        Make link
      </Link>
      <button type="button" onClick={dismiss} aria-label="Not now" className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
        <X className="size-4" />
      </button>
    </div>
  );
}

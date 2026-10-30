"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const subscribeToNothing = () => () => undefined;

/** The address of this site, known only in the browser. It is empty while the page is drawn on the server. */
export const useOrigin = (): string => useSyncExternalStore(subscribeToNothing, () => window.location.origin, () => "");
const useCanShare = (): boolean => useSyncExternalStore(subscribeToNothing, () => typeof navigator.share === "function", () => false);

/** The link on screen with Copy (and Share, where the device has it), for a link that is shown once and never kept. */
export function LinkActions({ path, shareTitle, shareLabel = "Share" }: { readonly path: string; readonly shareTitle: string; readonly shareLabel?: string }) {
  const origin = useOrigin();
  const canShare = useCanShare();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const link = origin ? `${origin}${path}` : null;

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
      await navigator.share({ title: shareTitle, url: link });
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  return (
    <>
      <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm break-all select-all">{link ?? ""}</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" onClick={copyLink} className="h-10 flex-1 rounded-full">
          {copy === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copy === "copied" ? "Copied" : copy === "failed" ? "Select and copy" : "Copy link"}
        </Button>
        {canShare ? (
          <Button type="button" variant="secondary" onClick={shareLink} className="h-10 flex-1 rounded-full">
            <Share2 className="size-4" />
            {shareLabel}
          </Button>
        ) : null}
      </div>
    </>
  );
}

"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { LinkActions } from "@/components/link-actions";
import { Button } from "@/components/ui/button";
import { makeAccessLink } from "./access-actions";

/**
 * "Get back in on a new phone, or after clearing your browser." The link is the person's own sign-in, so it is shown once
 * here and never kept, and making a new one replaces the old.
 */
export function AccessLinkPanel({ groupId, groupName }: { readonly groupId: string; readonly groupName: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const result = await makeAccessLink(groupId);
      if (!result.ok) return setError(result.error);
      setPath(`/back/${result.token}`);
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="access" aria-labelledby="access-heading" className="scroll-mt-20 rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 id="access-heading" className="font-semibold">
            Your access link
          </h2>
          <p className="text-sm text-muted-foreground">Get back in on a new phone, or after clearing your browser.</p>
        </div>
      </div>

      {path ? (
        <>
          <LinkActions path={path} shareTitle={`${groupName}: my access link`} shareLabel="Send to myself" />
          <p role="note" className="mt-3 text-xs text-muted-foreground">
            Anyone with this link can act as you, so keep it private. This is shown once. Making a new link signs out your other phones and browsers.
          </p>
        </>
      ) : (
        <Button type="button" variant="secondary" onClick={make} disabled={busy} className="mt-3 h-11 w-full rounded-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Make my link"}
        </Button>
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

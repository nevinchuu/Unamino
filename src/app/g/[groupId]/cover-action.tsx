"use client";

import { HandCoins, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PlanViewDto } from "@/domain/plan/view";
import { CoverSheet } from "./plan/[planId]/cover-sheet";

interface CoverActionProps {
  readonly planId: string;
  /** Called with a line to show, once the cover is in or something went wrong. */
  readonly onNote: (text: string) => void;
}

/**
 * A small button for the plan sheet in the chat that opens the same cover sheet as the plan screen, so nobody has to open
 * the full plan to cover a friend. The sheet needs everyone's shares, which the chat does not carry, so they are fetched when
 * the button is tapped and always fresh.
 */
export function CoverAction({ planId, onNote }: CoverActionProps) {
  const [view, setView] = useState<PlanViewDto | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function show() {
    setLoading(true);
    try {
      const response = await fetch(`/api/plans/${planId}/view`, { cache: "no-store" });
      if (!response.ok) throw new Error(`plan answered ${response.status}`);
      setView((await response.json()) as PlanViewDto);
      setOpen(true);
    } catch {
      onNote("Couldn't load the plan to cover a share. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" aria-label="Cover a friend's share" title="Cover a friend's share" className="size-12 shrink-0 rounded-2xl p-0" disabled={loading} onClick={() => void show()}>
        {loading ? <Loader2 className="size-5 animate-spin" /> : <HandCoins className="size-5" />}
      </Button>
      {view ? (
        <CoverSheet
          open={open}
          onOpenChange={setOpen}
          view={view}
          onDone={(text) => {
            setOpen(false);
            onNote(text);
          }}
        />
      ) : null}
    </>
  );
}

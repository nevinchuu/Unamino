"use client";

import { Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clockText, isUrgent, priceHoldElapsed } from "@/lib/plan-stage";
import { cn } from "@/lib/utils";

/**
 * How long the held prices last, counting down by the second so the group feels the clock. Turns red in the last
 * two minutes. When the time runs out the prices are renewed in the background, so it says that instead of "expired".
 */
export function PlanCountdown({ deadlineAt, className }: { readonly deadlineAt: string; readonly className?: string }) {
  const deadline = useMemo(() => new Date(deadlineAt), [deadlineAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ticking = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(ticking);
  }, []);

  const at = new Date(now);
  const elapsed = priceHoldElapsed(deadline, at);
  return (
    <span role="timer" suppressHydrationWarning className={cn("inline-flex items-center gap-1 text-xs font-bold tabular-nums", isUrgent(deadline, at) && "text-destructive", className)}>
      <Timer className="size-3.5 shrink-0" aria-hidden="true" />
      {elapsed ? "Checking prices again…" : `${clockText(deadline, at)} left`}
    </span>
  );
}

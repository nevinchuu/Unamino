import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What the chip says about the state of things: good news, still waiting, finished, or nothing special. */
export type ChipTone = "success" | "pending" | "solid" | "neutral";

const TONES: Record<ChipTone, string> = {
  success: "bg-accent text-accent-foreground",
  pending: "bg-pending text-pending-foreground",
  solid: "bg-success text-primary-foreground",
  neutral: "bg-secondary text-muted-foreground",
};

/** A small rounded label for a status, like "2 of 4 agreed" or "Booked". */
export function StatusChip({ tone = "neutral", children, className }: { readonly tone?: ChipTone; readonly children: ReactNode; readonly className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-none font-bold", TONES[tone], className)}>{children}</span>;
}

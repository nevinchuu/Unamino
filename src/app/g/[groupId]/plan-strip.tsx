import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { PlanCountdown } from "@/components/plan-countdown";
import { StatusChip } from "@/components/status-chip";
import { LIVE_PLAN_STATUSES } from "@/domain/plan/view";
import type { CardPlan } from "@/lib/plan-card";
import { tripStatus } from "@/lib/trip-list";

/**
 * A slim bar under the chat header that always points at the group's current plan, so it can be opened without
 * scrolling back to the message that announced it, however long the chat has grown.
 */
export function PlanStrip({ groupId, plan }: { readonly groupId: string; readonly plan: CardPlan }) {
  const status = tripStatus(plan, plan.mine?.people ?? []);
  if (!status) return null;
  return (
    <Link href={`/g/${groupId}/plan/${plan.id}`} aria-label={`Open the plan: ${plan.title}, ${status.label}`} className="flex min-h-12 items-center gap-3 border-b border-border bg-card px-4 text-sm hover:bg-muted">
      <span className="min-w-0 flex-1 truncate font-bold">{plan.title}</span>
      {LIVE_PLAN_STATUSES.includes(plan.status) ? <PlanCountdown deadlineAt={plan.deadlineAt} /> : null}
      <StatusChip tone={status.tone}>{status.label}</StatusChip>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

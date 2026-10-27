import { describePlanCard, type LatestPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";

/**
 * The card under the agent's plan announcement. It shows where the plan stands. It cannot be opened yet: the screen
 * where each person agrees to the plan comes next.
 */
export function PlanCard({ planId, latest }: { readonly planId: string; readonly latest: LatestPlan | null }) {
  const view = describePlanCard(planId, latest);
  return (
    <div className={cn("mt-2 rounded-xl border border-border bg-background px-3 py-2", view.state !== "live" && "opacity-70")}>
      <p className="text-sm font-semibold">{view.title}</p>
      {view.people ? <p className="text-xs text-muted-foreground">{view.people}</p> : null}
      <p className={cn("mt-1 text-xs font-medium", view.state === "live" ? "text-primary" : "text-muted-foreground")}>{view.detail}</p>
    </div>
  );
}

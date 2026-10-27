import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { describePlanCard, type LatestPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";

/**
 * The card under the agent's plan announcement. It shows where the plan stands and opens the plan. A plan that
 * a newer one replaced points to the newer one, since that is the one the group is working on.
 */
export function PlanCard({ groupId, planId, latest }: { readonly groupId: string; readonly planId: string; readonly latest: LatestPlan | null }) {
  const view = describePlanCard(planId, latest);
  const target = view.state === "live" ? planId : view.state === "replaced" && latest ? latest.id : null;

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{view.title}</p>
        {view.people ? <p className="text-xs text-muted-foreground">{view.people}</p> : null}
        <p className={cn("mt-1 text-xs font-medium", view.state === "live" ? "text-primary" : "text-muted-foreground")}>{view.detail}</p>
        {target ? <p className="mt-1 text-xs font-semibold text-primary">{view.state === "live" ? "Open the plan" : "See the newer plan"}</p> : null}
      </div>
      {target ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  const style = cn("mt-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2", view.state !== "live" && "opacity-80");
  return target ? (
    <Link href={`/g/${groupId}/plan/${target}`} className={cn(style, "hover:bg-muted")}>
      {content}
    </Link>
  ) : (
    <div className={style}>{content}</div>
  );
}

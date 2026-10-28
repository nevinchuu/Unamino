import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { describePlanCard, type CardPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";

/**
 * The card under the agent's plan announcement. It shows where that plan stands and opens it. A plan that a newer one
 * replaced points to the newer one, since that is the one the group is working on. Deciding on the plan happens in the
 * sheet above the composer, so this card only reports and links.
 */
export function PlanCard({ groupId, planId, plans }: { readonly groupId: string; readonly planId: string; readonly plans: readonly CardPlan[] }) {
  const view = describePlanCard(planId, plans);
  const target = view.opens;

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{view.title}</p>
        {view.people ? <p className="text-xs text-muted-foreground">{view.people}</p> : null}
        <p className={cn("mt-1 text-xs font-medium", view.state === "live" ? "text-success" : "text-muted-foreground")}>{view.detail}</p>
        {target ? <p className="mt-1 text-xs font-semibold text-link">{view.state === "live" ? "Open the plan" : "See the newer plan"}</p> : null}
      </div>
      {target ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  const style = cn("mt-2 flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 shadow-soft", view.state !== "live" && "opacity-80");
  return target ? (
    <Link href={`/g/${groupId}/plan/${target}`} className={cn(style, "hover:bg-muted")}>
      {content}
    </Link>
  ) : (
    <div className={style}>{content}</div>
  );
}

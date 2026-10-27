import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { AppBar, Screen } from "@/components/screen";
import { getContainer } from "@/server/container";
import { loadPlanViewFor } from "@/server/plan-view";
import { currentMember } from "@/server/session";
import { NotAMember } from "../../not-a-member";
import { PlanScreen } from "./plan-screen";

// Agreeing or approving checks the prices again first, which can take several seconds.
export const maxDuration = 60;

export default function PlanPage({ params }: PageProps<"/g/[groupId]/plan/[planId]">) {
  return (
    <Screen className="h-dvh">
      <Suspense fallback={<AppBar title="Plan" />}>
        <Plan params={params} />
      </Suspense>
    </Screen>
  );
}

async function Plan({ params }: { readonly params: PageProps<"/g/[groupId]/plan/[planId]">["params"] }) {
  const { groupId, planId } = await params;
  if (!(await currentMember(groupId))) return <NotAMember />;

  const { views, plans, demoHolds } = getContainer();
  const loaded = await loadPlanViewFor({ views, memberOf: currentMember, demoHolds, scheduleRefresh: (id) => after(() => plans.refresh(id, new Date())) }, planId);

  // A plan from another group is shown as missing, like one that does not exist.
  if (!loaded.ok || loaded.view.groupId !== groupId) {
    return (
      <>
        <AppBar title="Plan" backHref={`/g/${groupId}`} />
        <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
          <h2 className="text-xl font-semibold">We couldn&apos;t find this plan</h2>
          <Link href={`/g/${groupId}`} className="text-sm font-medium text-primary">
            Back to the chat
          </Link>
        </main>
      </>
    );
  }
  return <PlanScreen initial={loaded.view} />;
}

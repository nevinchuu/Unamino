"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { formatMinor } from "@/lib/format-money";
import type { CardDetail } from "@/lib/plan-card";
import { cn } from "@/lib/utils";
import { IdeaCard, ItemCard } from "./plan/[planId]/plan-items";

type TabId = "flight" | "hotel" | "activity";

const TAB_LABEL: Record<TabId, string> = { flight: "Flights", hotel: "Stays", activity: "Activities" };
const TAB_ORDER: readonly TabId[] = ["flight", "hotel", "activity"];

/** The agent's picks in a tab, outlined so the one chosen is plain to see. */
function Picked({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative rounded-xl ring-2 ring-link">
      <span className="absolute -top-2.5 right-3 rounded-full bg-link px-2 py-0.5 text-xs font-semibold text-white">Picked</span>
      {children}
    </div>
  );
}

/**
 * The plan opened in the sheet above the composer: the flights, stays and activities Trippy picked, one tab for each, and what the trip
 * costs. Deciding stays in the sheet above the composer, and the full plan screen is one tap away.
 */
export function PlanPreview({ detail, planHref }: { readonly detail: CardDetail; readonly planHref: string }) {
  const tabs = TAB_ORDER.filter((tab) => (tab === "activity" ? detail.items.some((item) => item.kind === "activity") || detail.ideas.length > 0 : detail.items.some((item) => item.kind === tab)));
  const ids = useId();
  const [chosen, setChosen] = useState<TabId | null>(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : (tabs[0] ?? null);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        {detail.subtitle ? `${detail.subtitle} · ` : ""}planned by Trippy
      </p>

      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Parts of the plan" className="mt-3 flex gap-1.5">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${ids}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${ids}-panel`}
              onClick={() => setChosen(id)}
              className={cn("min-h-11 flex-1 rounded-full px-3 text-sm font-semibold", tab === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>
      ) : null}

      {tab ? (
        <div role="tabpanel" id={`${ids}-panel`} aria-label={TAB_LABEL[tab]} className="mt-4 space-y-4">
          {detail.items
            .filter((item) => item.kind === tab)
            .map((item) => (
              <Picked key={item.id}>
                <ItemCard item={item} asTags />
              </Picked>
            ))}
          {tab === "activity" && detail.ideas.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Free-time ideas</p>
              {detail.ideas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-sm text-muted-foreground">Trip total</span>
        <b className="text-base">{detail.totalMinor === null ? "Not priced yet" : formatMinor(detail.totalMinor, detail.currency)}</b>
      </div>
      <Link href={planHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-link">
        Open the full plan
      </Link>
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * The action at the bottom of a long sheet, kept in view while the rest scrolls, so a person never has to hunt for the
 * button that finishes the step. It fills the sheet's width and sits against its bottom edge, and keeps clear of a
 * phone's home bar. The negative offset is the sheet's own bottom padding: a sticky element stops at the inside of a
 * padded scroller, so it has to reach past it to sit flush against the edge.
 */
export function StickyFooter({ children }: { readonly children: ReactNode }) {
  return <div className="sticky -bottom-6 z-10 -mx-5 space-y-2 border-t border-border bg-background px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>;
}

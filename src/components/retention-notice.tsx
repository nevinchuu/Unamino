import Link from "next/link";
import { retentionNotice } from "@/lib/retention-notice";

/** Tells people how long their trip stays in the app, and where the full privacy notice is. */
export function RetentionNotice({ keptUntil, className }: { readonly keptUntil: string | null; readonly className?: string }) {
  return (
    <p role="note" className={className ?? "text-xs text-muted-foreground"}>
      {retentionNotice(keptUntil)}{" "}
      <Link href="/privacy" className="font-medium text-primary underline underline-offset-2">
        Privacy notice
      </Link>
    </p>
  );
}

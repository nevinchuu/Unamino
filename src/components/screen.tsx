import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ScreenProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** The pale mint gradient behind a screen made of cards, instead of the plain background. */
  readonly wash?: boolean;
}

/** One phone-width column, centred on larger screens, the way the app is meant to be held. */
export function Screen({ children, className, wash = false }: ScreenProps) {
  return <div className={cn("relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col sm:border-x sm:border-border", wash ? "bg-wash" : "bg-background", className)}>{children}</div>;
}

interface AppBarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: ReactNode;
  /** Shows a back arrow that goes here. */
  readonly backHref?: string;
}

/** The bar across the top of a screen: a title and, under it, one quiet line. */
export function AppBar({ title, subtitle, leading, backHref }: AppBarProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground">
      {backHref ? (
        <Link href={backHref} aria-label="Back" className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
      ) : null}
      {leading}
      <div className="min-w-0">
        <h1 className="truncate text-lg leading-tight font-extrabold">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </header>
  );
}

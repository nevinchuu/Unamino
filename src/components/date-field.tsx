"use client";

import { useId, useRef, useState } from "react";
import { cleanParts, composeDate, isFull, type DateParts } from "@/lib/date-input";
import { cn } from "@/lib/utils";

interface DateFieldProps {
  /** The name of the one value the form sends: "YYYY-MM-DD", or empty while the boxes are not filled in. */
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  /** Browsers fill in a birthday from these when asked to. */
  readonly autoComplete?: "bday";
}

const BOX = "border-0 border-b-2 border-muted-foreground/70 bg-transparent px-0 py-2 text-center text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary aria-invalid:border-destructive";

/**
 * A date as three boxes, day then month then year, which is how people say it and what the label promises. The browser's own
 * date control follows the device's region, so one person saw month first under a label that said day first. Focus moves on
 * by itself as a box fills.
 */
export function DateField({ name, label, error, autoComplete }: DateFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [parts, setParts] = useState<DateParts>({ day: "", month: "", year: "" });
  const month = useRef<HTMLInputElement>(null);
  const year = useRef<HTMLInputElement>(null);

  const change = (key: keyof DateParts, value: string) => {
    const next = cleanParts({ ...parts, [key]: value });
    setParts(next);
    if (key === "day" && isFull(next.day, 2)) month.current?.focus();
    if (key === "month" && isFull(next.month, 2)) year.current?.focus();
  };
  const invalid = error ? true : undefined;

  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex items-end gap-3">
        <input aria-label="Day" aria-invalid={invalid} inputMode="numeric" maxLength={2} placeholder="DD" autoComplete={autoComplete && "bday-day"} value={parts.day} onChange={(event) => change("day", event.target.value)} className={cn(BOX, "w-12")} />
        <input ref={month} aria-label="Month" aria-invalid={invalid} inputMode="numeric" maxLength={2} placeholder="MM" autoComplete={autoComplete && "bday-month"} value={parts.month} onChange={(event) => change("month", event.target.value)} className={cn(BOX, "w-12")} />
        <input ref={year} aria-label="Year" aria-invalid={invalid} inputMode="numeric" maxLength={4} placeholder="YYYY" autoComplete={autoComplete && "bday-year"} value={parts.year} onChange={(event) => change("year", event.target.value)} className={cn(BOX, "w-16")} />
      </div>
      <input type="hidden" name={name} value={composeDate(parts)} />
      <p id={errorId} aria-live="polite" className="min-h-4 text-xs text-destructive">
        {error}
      </p>
    </fieldset>
  );
}

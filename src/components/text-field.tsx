import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  readonly error?: string;
}

/** A field with a quiet label above it and a line underneath, which turns blue as you type and red when something is wrong. */
export function TextField({ label, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full border-0 border-b-2 border-input bg-transparent px-0 py-2 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary aria-invalid:border-destructive",
          className,
        )}
        {...input}
      />
      <p id={errorId} aria-live="polite" className="min-h-4 text-xs text-destructive">
        {error}
      </p>
    </div>
  );
}

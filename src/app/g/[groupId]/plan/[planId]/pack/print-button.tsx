"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" is one of the choices. */
export function PrintButton() {
  return (
    <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" onClick={() => window.print()}>
      <Printer className="size-5" aria-hidden />
      Print or save as PDF
    </Button>
  );
}

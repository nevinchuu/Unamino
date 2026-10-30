import { Suspense } from "react";
import { DemoNote } from "@/components/demo-note";
import { Screen } from "@/components/screen";
import { TripsHeader, TripsHome } from "./trips-home";

export default function Home() {
  return (
    <Screen wash>
      {/* Reading this browser's cookies is per-visitor, so the list streams in behind the title. */}
      <Suspense fallback={<TripsHeader />}>
        <TripsHome />
      </Suspense>
      <DemoNote />
    </Screen>
  );
}

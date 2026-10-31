import { AboutBlurb } from "@/components/about-blurb";
import { DemoNote } from "@/components/demo-note";
import { AppBar, Screen } from "@/components/screen";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { CreateGroupForm } from "../create-group-form";
import { DemoButton } from "../demo-button";

export default function NewGroup() {
  return (
    <Screen>
      <AppBar title="New group" subtitle="Plan a trip together" />
      <div className="px-6 pt-5">
        <AboutBlurb />
      </div>
      <DemoButton />
      <CreateGroupForm currency={GROUP_CURRENCY} />
      <DemoNote />
    </Screen>
  );
}

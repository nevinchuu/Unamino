import { AppBar, Screen } from "@/components/screen";
import { GROUP_CURRENCY } from "@/server/group-currency";
import { CreateGroupForm } from "./create-group-form";

export default function Home() {
  return (
    <Screen>
      <AppBar title="New group" subtitle="Plan a trip together" />
      <CreateGroupForm currency={GROUP_CURRENCY} />
    </Screen>
  );
}

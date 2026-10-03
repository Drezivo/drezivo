import { redirect } from "next/navigation";

import { WORKSPACE_HOME } from "@/lib/workspace-routes";

// The calendar is the first screen of the workspace: rental shops run their day from it.
export default function WorkspaceHomePage() {
  redirect(WORKSPACE_HOME);
}

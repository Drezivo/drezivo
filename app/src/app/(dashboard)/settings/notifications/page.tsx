import { redirect } from "next/navigation";

import { NotificationSettingsPage } from "@/components/settings/notification-settings-page";
import { SHOW_NOTIFICATION_SETTINGS } from "@/lib/features";

export default function Page() {
  // Hidden during the pilot (customer emails always send); kept for when toggles return.
  if (!SHOW_NOTIFICATION_SETTINGS) redirect("/settings");
  return <NotificationSettingsPage />;
}

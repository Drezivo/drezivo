import { redirect } from "next/navigation";

// /settings has no content of its own — Account is the first tab in the settings layout.
export default function SettingsIndexPage() {
  redirect("/settings/account");
}

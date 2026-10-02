import type { Metadata } from "next";

import { HelpCenterPage } from "@/components/help/help-center-page";

export const metadata: Metadata = { title: "Help Center" };

export default function Page() {
  return <HelpCenterPage />;
}

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { StaffAuthPage } from "@/components/auth/staff-auth-page";

export default async function SignInPage() {
  const { userId } = await auth();
  if (userId) {
    redirect("/");
  }

  return <StaffAuthPage />;
}

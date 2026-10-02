import { StaffAuthPage } from "@/components/auth/staff-auth-page";

// Prerendered for the same reason as the sign-in page.
export function generateStaticParams() {
  return [{ "sign-up": [] }];
}

export default function SignUpPage() {
  return <StaffAuthPage mode="sign-up" />;
}

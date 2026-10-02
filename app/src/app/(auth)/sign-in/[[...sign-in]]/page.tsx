import { StaffAuthPage } from "@/components/auth/staff-auth-page";

// Static on purpose: a signed-in visitor is redirected by the middleware before this renders,
// so the page needs no per-request server work and is served from the CDN cache. An optional
// catch-all is only prerendered when its params are listed; Clerk's own sub-steps
// (/sign-in/factor-one, ...) still render on demand.
export function generateStaticParams() {
  return [{ "sign-in": [] }];
}

export default function SignInPage() {
  return <StaffAuthPage />;
}

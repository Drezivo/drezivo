import { StaffAuthPage } from "@/components/auth/staff-auth-page";

// Static on purpose: a signed-in visitor is redirected by the middleware before this renders,
// so the page needs no per-request server work and is served from the CDN cache.
export default function SignInPage() {
  return <StaffAuthPage />;
}

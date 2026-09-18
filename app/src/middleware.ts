import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the auth pages and the readiness probe are public. Everything else in this app is
// staff-only — fail closed by default rather than relying on a route allowlist.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/health",
]);

export default clerkMiddleware(
  async (auth, request) => {
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  },
  {
    // Keep unauthenticated app requests inside Drezivo. Without this
    // explicit path, Clerk falls back to the hosted accounts.dev sign-in page.
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static assets, always run for API routes.
    "/((?!_next|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
    "/(api|trpc)(.*)",
  ],
};

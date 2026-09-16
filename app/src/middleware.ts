import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the auth pages and the readiness probe are public. Everything else in this app is
// staff-only (TRD §3 staff request path) — fail closed by default rather than listing
// dashboard routes as an allowlist that a new route could accidentally miss.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets, always run for API routes.
    "/((?!_next|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
    "/(api|trpc)(.*)",
  ],
};

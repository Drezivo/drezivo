import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Only the auth pages and the readiness probe are public. Everything else in this app is
// staff-only — fail closed by default rather than relying on a route allowlist.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/accept-invitation(.*)",
  "/api/health",
]);
// A session already exists here, so Clerk would refuse a second sign-in or sign-up (session_exists).
const isAuthPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isInvitationRoute = createRouteMatcher(["/accept-invitation(.*)"]);

type MiddlewareAuth = {
  (): Promise<{ userId: string | null }>;
  protect: () => Promise<unknown>;
};

/**
 * Route access, decided at the edge from the verified session cookie (no network call).
 * Signed-in visitors on auth pages enter the server-verified workspace resolver. The invitation
 * route is public but uncached and suppresses referrers because its first URL has a one-time ticket.
 */
export async function routeAccess(
  auth: MiddlewareAuth,
  request: NextRequest
): Promise<NextResponse | undefined> {
  if (isAuthPage(request)) {
    const { userId } = await auth();
    return userId ? NextResponse.redirect(new URL("/auth/resolve", request.url)) : undefined;
  }
  if (isInvitationRoute(request)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
  return undefined;
}

export default clerkMiddleware((auth, request) => routeAccess(auth, request), {
  // Keep unauthenticated app requests inside Drezivo. Without this
  // explicit path, Clerk falls back to the hosted accounts.dev sign-in page.
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up",
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets, always run for API routes.
    "/((?!_next|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
    "/(api|trpc)(.*)",
  ],
};

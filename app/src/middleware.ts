import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { WORKSPACE_HOME } from "@/lib/workspace-routes";

// Only the auth pages and the readiness probe are public. Everything else in this app is
// staff-only — fail closed by default rather than relying on a route allowlist.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/health",
]);
const isSignInRoute = createRouteMatcher(["/sign-in(.*)"]);

type MiddlewareAuth = {
  (): Promise<{ userId: string | null }>;
  protect: () => Promise<unknown>;
};

/**
 * Route access, decided at the edge from the verified session cookie (no network call).
 * A signed-in visitor on the sign-in page goes straight to the dashboard here, so the sign-in
 * and sign-up pages themselves stay static and are served from the CDN cache instantly.
 */
export async function routeAccess(auth: MiddlewareAuth, request: NextRequest): Promise<NextResponse | undefined> {
  if (isSignInRoute(request)) {
    const { userId } = await auth();
    return userId ? NextResponse.redirect(new URL(WORKSPACE_HOME, request.url)) : undefined;
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

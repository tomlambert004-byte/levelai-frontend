import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Public routes that do NOT require Clerk auth checks.
 * This prevents unnecessary Clerk API calls on marketing pages,
 * reducing risk of Clerk rate limits (429) on high-traffic pages.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/terms(.*)",
  "/hipaa(.*)",
  "/privacy(.*)",
  "/contact(.*)",
  "/pricing(.*)",
  "/sso-callback(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Skip auth enforcement on public marketing & legal pages
  if (isPublicRoute(req)) return;

  const { userId } = await auth();

  // Unauthenticated users hitting /dashboard get redirected to /login
  // Exception: ?sandbox=1 allows unauthenticated access for demo mode
  if (!userId && req.nextUrl.pathname.startsWith("/dashboard") && req.nextUrl.searchParams.get("sandbox") !== "1") {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // All other routes (dashboard, API) — protect with Clerk
  // API routes handle their own auth via auth() calls
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

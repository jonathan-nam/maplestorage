import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Next.js 16 renamed middleware.ts -> proxy.ts; this file plays the same role.
// /characters and /upload only redirect now (see next.config redirects and app/upload), but they
// stay gated so an unauthenticated hit lands on sign-in rather than leaking the redirect target.
const isProtectedRoute = createRouteMatcher(["/inventory(.*)", "/characters(.*)", "/upload(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};

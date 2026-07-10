import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16 renamed middleware.ts -> proxy.ts; this file plays the same role.
// No routes are protected here yet -- clerkMiddleware() with no callback just
// makes auth state available. M2 (Character CRUD) is expected to add
// createRouteMatcher()-gated protection once there's something to protect.
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `next build` writes to the same directory `next dev` serves from, so running a
  // production build while the dev server is up POISONS it: the dev server keeps
  // serving the pre-build pages and never recompiles, and its compile log stays
  // silent, because nothing recompiled. It looks exactly like "my changes did
  // nothing", and it cost several rounds of confusion before we spotted it.
  //
  // NEXT_DIST_DIR sends a build somewhere else:
  //     NEXT_DIST_DIR=.next-prod npx next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

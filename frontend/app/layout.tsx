import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { WebVitals } from "@/components/web-vitals";
import "./globals.css";

export const metadata: Metadata = {
  title: "SharpEyes",
  description: "Your boss tokens, every character, counted in one place.",
};

// Clerk resolves auth in the browser, so the header's signed-in controls cannot be drawn on first
// paint and their arrival shifts the brand sideways (measured: 54px). __client_uat is Clerk's own
// "is there a session" cookie on the app domain: "0" or absent means signed out. It only decides
// whether to HOLD SPACE, never what to show, so a stale value costs a reserved gap and cannot leak
// a signed-in view.
//
// This is a blocking script rather than a cookies() read in this component because cookies() opted
// EVERY route into dynamic rendering. Nothing could be prerendered, and dynamic segments get a
// client-router staleTime of 0, so no navigation was ever served from the router cache: each one
// paid a fresh server round-trip through Clerk middleware. Deciding it here costs one synchronous
// cookie match and keeps the routes static.
//
// It sits above the header in the body so it runs before the header is parsed, which is what makes
// the reservation a first-paint decision as the server read was. The class is read by
// `html:not(.has-session) .header-reserved` in globals.css.
const RESERVE_CONTROLS = `try{var m=document.cookie.match(/(?:^|;\\s*)__client_uat=([^;]*)/);if(m&&m[1]&&m[1]!=="0")document.documentElement.classList.add("has-session")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      {/* Dark only: the palette is fixed in :root, so there is no theme to read before paint and
          nothing to flash. suppressHydrationWarning because the script above adds a class here
          before React hydrates, which is a difference React would otherwise report. */}
      <html lang="en" suppressHydrationWarning>
        <body>
          <script dangerouslySetInnerHTML={{ __html: RESERVE_CONTROLS }} />
          <WebVitals />
          <SiteHeader />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

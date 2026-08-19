import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavPending } from "@/components/nav-pending";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WebVitals } from "@/components/web-vitals";
import { WorldVeil } from "@/components/world-veil";
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

// Carries the world-switch veil across the reload the switch does.
//
// WorldToggle raises the veil on click and sets this flag; the reload then throws that DOM away.
// Restoring it here rather than from a React effect is the whole point: an effect runs after the
// first paint, so the new world's page would flash for a frame before being covered, which is the
// flicker the veil exists to remove.
//
// It takes itself down on `load`, and the flag is cleared the moment it is read, so a veil can only
// ever outlive one navigation. The timeout is the backstop for the case that matters more than
// tidiness: `load` never firing would otherwise leave the app behind a veil with no way out.
const WORLD_VEIL = `try{if(sessionStorage.getItem("switching-world")){sessionStorage.removeItem("switching-world");var d=document.documentElement;d.classList.add("switching-world");var off=function(){d.classList.remove("switching-world")};window.addEventListener("load",off,{once:true});setTimeout(off,8000)}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      {/* Dark only: the palette is fixed in :root, so there is no theme to read before paint and
          nothing to flash. suppressHydrationWarning because the script above adds a class here
          before React hydrates, which is a difference React would otherwise report. */}
      <html lang="en" suppressHydrationWarning>
        <body>
          <script dangerouslySetInnerHTML={{ __html: RESERVE_CONTROLS }} />
          <script dangerouslySetInnerHTML={{ __html: WORLD_VEIL }} />
          <WebVitals />
          <WorldVeil />
          {/* Above the header so it covers every link on the page, the header's included. */}
          <NavPending />
          <SiteHeader />
          {children}
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}

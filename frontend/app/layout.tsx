import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { cookies } from "next/headers";
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
// "is there a session" cookie on the app domain, readable here before any of that: "0" or absent
// means signed out. It only decides whether to HOLD SPACE, never what to show, so a stale value
// costs a reserved gap and cannot leak a signed-in view.
//
// The price: reading a cookie opts every route into dynamic rendering. /inventory and /upload were
// prerendered before this and are now server-rendered per request. Only the empty shell moves,
// both are client components that fetch all their data after load, so there is no work added to
// the request beyond rendering the header.
async function sessionCookiePresent() {
  const clientUat = (await cookies()).get("__client_uat")?.value;
  return clientUat !== undefined && clientUat !== "0";
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const reserveControls = await sessionCookiePresent();

  return (
    <ClerkProvider>
      {/* Dark only: the palette is fixed in :root, so there is no theme to read before paint and
          nothing to flash. */}
      <html lang="en">
        <body>
          <WebVitals />
          <SiteHeader reserveControls={reserveControls} />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "MapleStorage",
  description: "Your boss tokens, every character, counted in one place.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      {/* Dark only: the palette is fixed in :root, so there is no theme to read before paint and
          nothing to flash. */}
      <html lang="en">
        <body>
          <SiteHeader />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

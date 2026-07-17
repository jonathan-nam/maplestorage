"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Chest } from "./chest";

// Every page used to restate the app's name in its own <h1> and link to the others
// by hand. One header instead, with the chest as the mark.
export function SiteHeader() {
  return (
    <header className="site-header">
      {/* The bar is full-bleed, the inner wrapper carries the shared column, so the brand lines up
          with the page content underneath it. */}
      <div className="site-header-inner">
        <Link href="/" className="brand">
          <Chest size={28} />
          <span className="brand-name">MapleStorage</span>
        </Link>

        <SignedIn>
          {/* Characters is no longer a top-bar link: it is the section rail's job now, so the
              header carries only the brand and the account button. */}
          <div className="site-user">
            <UserButton />
          </div>
        </SignedIn>

        {/* Outside <SignedIn> on purpose: the sign-in page is a page too, and someone who prefers a
            light UI should not have to authenticate to get one. */}
        <ThemeToggle />
      </div>
    </header>
  );
}

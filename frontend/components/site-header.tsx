"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { SectionMenu } from "@/components/section-menu";
import { SharpEyesMark } from "./sharp-eyes-mark";

// Every page used to restate the app's name in its own <h1> and link to the others
// by hand. One header instead, with the Sharp Eyes mark.
export function SiteHeader() {
  return (
    <header className="site-header">
      {/* The bar is full-bleed, the inner wrapper carries the shared column, so the brand lines up
          with the page content underneath it. */}
      <div className="site-header-inner">
        {/* Sections open from a hamburger at the far left. Signed-in only: they are account views. */}
        <SignedIn>
          <SectionMenu />
        </SignedIn>

        <Link href="/" className="brand">
          <SharpEyesMark size={28} />
          <span className="brand-name">SharpEyes</span>
        </Link>

        <SignedIn>
          <div className="site-user">
            <UserButton />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}

"use client";

import { SignedIn } from "@clerk/nextjs";
import Link from "next/link";
import { SectionMenu } from "@/components/section-menu";
import { SharpEyesMark } from "./sharp-eyes-mark";
import { UserAvatar } from "@/components/user-avatar";

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
          {/* 32, not 28: the sprite is 32x32 and drawn with image-rendering pixelated, so a
              non-multiple size drops whole rows and columns, and which ones it drops shifts with
              zoom and display scaling. At 28 the mark visibly alternated between two shapes. */}
          <SharpEyesMark size={32} />
          <span className="brand-name">SharpEyes</span>
        </Link>

        <SignedIn>
          <div className="site-user">
            <UserAvatar />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}

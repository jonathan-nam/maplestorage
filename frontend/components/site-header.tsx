"use client";

import { ClerkLoading, SignedIn } from "@clerk/nextjs";
import Link from "next/link";
import { SectionMenu } from "@/components/section-menu";
import { SharpEyesMark } from "./sharp-eyes-mark";
import { UserAvatar } from "@/components/user-avatar";

// Every page used to restate the app's name in its own <h1> and link to the others
// by hand. One header instead, with the Sharp Eyes mark.
// reserveControls: a session cookie was present at request time, so the signed-in controls are
// about to appear and their boxes are held open until Clerk confirms it. See RootLayout.
export function SiteHeader({ reserveControls }: { reserveControls: boolean }) {
  return (
    <header className="site-header">
      {/* The bar is full-bleed, the inner wrapper carries the shared column, so the brand lines up
          with the page content underneath it. */}
      <div className="site-header-inner">
        {/* Sections open from a hamburger at the far left. Signed-in only: they are account views. */}
        {reserveControls && (
          <ClerkLoading>
            <div className="section-menu" aria-hidden="true">
              <div className="section-menu-btn is-reserved">
                <span className="section-menu-icon" />
              </div>
            </div>
          </ClerkLoading>
        )}
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

        {reserveControls && (
          <ClerkLoading>
            <div className="site-user" aria-hidden="true">
              <div className="user-avatar">
                <div className="user-avatar-btn is-reserved" />
              </div>
            </div>
          </ClerkLoading>
        )}
        <SignedIn>
          <div className="site-user">
            <UserAvatar />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}

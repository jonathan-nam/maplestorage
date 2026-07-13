"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Chest } from "./chest";

// Every page used to restate the app's name in its own <h1> and link to the others
// by hand. One header instead, with the chest as the mark.
export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <Chest size={28} />
        <span className="brand-name">MapleStorage</span>
      </Link>

      <SignedIn>
        <nav className="site-nav">
          {/* No Upload link any more: uploading is not a destination, it is something you do
              to a character, and it now lives on the character you are already looking at. */}
          <Link href="/characters" className={pathname.startsWith("/characters") ? "active" : ""}>
            Characters
          </Link>
        </nav>
        <div className="site-user">
          <UserButton />
        </div>
      </SignedIn>

      {/* Outside <SignedIn> on purpose: the sign-in page is a page too, and someone who prefers a
          light UI should not have to authenticate to get one. */}
      <ThemeToggle />
    </header>
  );
}

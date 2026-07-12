"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
          <Link href="/characters" className={pathname.startsWith("/characters") ? "active" : ""}>
            Characters
          </Link>
          <Link href="/upload" className={pathname.startsWith("/upload") ? "active" : ""}>
            Upload
          </Link>
        </nav>
        <div className="site-user">
          <UserButton />
        </div>
      </SignedIn>
    </header>
  );
}

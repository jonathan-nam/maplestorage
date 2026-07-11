import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { BackendStatus } from "./backend-status";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>MapleStorage</h1>

      <SignedOut>
        <SignInButton />
      </SignedOut>

      <SignedIn>
        <UserButton />
        <p>
          <Link href="/characters">Characters</Link>
        </p>
        <BackendStatus />
      </SignedIn>
    </main>
  );
}

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
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
        <BackendStatus />
      </SignedIn>
    </main>
  );
}

import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { AccountOverview } from "@/components/account-overview";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";

export default function Home() {
  return (
    <main className="page">
      <SignedOut>
        <section className="hero">
          <SharpEyesMark size={96} />
          <h1>A greater view of your whole MapleStory account.</h1>
          <p>
            Farming the same Grandis boss across a stable of mules is normal. Working out how close
            you actually are to a full Eternal set is not, because the game only ever shows you one
            character at a time.
          </p>
          <p>
            Screenshot each character with their inventory open, drop the lot in, and SharpEyes
            reads the counts and adds them up. Every character, in one view.
          </p>
          <SignInButton />
        </section>
      </SignedOut>

      {/* The front page was a welcome and a link to somewhere else. It is the account's standing
          now: what the period still owes, and how long is left to do it in. */}
      <SignedIn>
        <h1 className="page-title">Overview</h1>
        <AccountOverview />
      </SignedIn>
    </main>
  );
}

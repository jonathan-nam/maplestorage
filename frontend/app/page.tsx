import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { Chest } from "@/components/chest";

export default function Home() {
  return (
    <main style={{ padding: "2rem" }}>
      <SignedOut>
        <section className="hero">
          <Chest size={96} />
          <h1>Your storage room</h1>
          <p>
            Farming the same Grandis boss across a stable of mules is normal. Working out how close
            you actually are to a full Eternal set is not, because the game only ever shows you one
            character at a time.
          </p>
          <p>
            Screenshot each character with their inventory open, drop the lot in, and MapleStorage
            reads the counts and adds them up. One room, everything in it.
          </p>
          <SignInButton />
        </section>
      </SignedOut>

      <SignedIn>
        <section className="hero">
          <Chest size={64} open />
          <h1>Welcome back</h1>
          <p>
            <Link href="/characters">See where you stand</Link>, and drop a screenshot on whichever
            character it belongs to.
          </p>
        </section>
      </SignedIn>
    </main>
  );
}

import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
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
            Keep each character&apos;s counts here and SharpEyes adds them up. Every character, in
            one view.
          </p>
          <SignInButton />
        </section>
      </SignedOut>

      <SignedIn>
        <section className="hero">
          <SharpEyesMark size={64} />
          <h1>Welcome back</h1>
          <p>
            <Link href="/inventory">See where you stand</Link>.
          </p>
        </section>
      </SignedIn>
    </main>
  );
}

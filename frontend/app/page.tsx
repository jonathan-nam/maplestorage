"use client";

import Link from "next/link";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { SignInButton } from "@/components/sign-in-button";
import { PASSWORD_LOGIN } from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth();

  // Neither hero until the session is known. Drawing the signed-out one first and swapping it is a
  // returning user being asked to sign in for a frame.
  if (!isLoaded) return <main className="page" />;

  return (
    <main className="page">
      {isSignedIn ? (
        <section className="hero">
          <SharpEyesMark size={64} />
          <h1>Welcome back</h1>
          <p>
            <Link href="/bosses">See where you stand</Link>.
          </p>
        </section>
      ) : (
        <section className="hero">
          <SharpEyesMark size={96} />
          <h1>A greater view of your whole MapleStory account.</h1>
          <SignInButton />
          {PASSWORD_LOGIN ? (
            <p className="hero-alt">
              <Link href="/sign-in">or use an email and password</Link>
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

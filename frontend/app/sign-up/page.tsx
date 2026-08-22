"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthField, AuthForm } from "@/components/auth-form";
import { authClient } from "@/lib/auth-client";

// Matches the auth service's minPasswordLength. Stated on the field rather than only enforced,
// because a rejected password after submitting is a rule you were not told.
const MIN_PASSWORD = 12;

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    if (password.length < MIN_PASSWORD) return `Passwords are ${MIN_PASSWORD} characters or more.`;
    const { error } = await authClient.signUp.email({ name, email, password });
    // Deliberately not distinguishing "already registered": the server does not either, so that a
    // stranger cannot use this form to find out who has an account here.
    return error ? "Could not create that account." : null;
  }

  return (
    <main className="page">
      <AuthForm
        title="Create an account"
        submitLabel="Create account"
        onSubmit={submit}
        done="Check your email for a link to confirm the address."
        footer={<Link href="/sign-in">Already have one? Sign in</Link>}
      >
        <AuthField label="Name" type="text" value={name} onChange={setName} autoComplete="name" />
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <AuthField
          label={`Password (${MIN_PASSWORD}+ characters)`}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
      </AuthForm>
    </main>
  );
}

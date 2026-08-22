"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthField, AuthForm } from "@/components/auth-form";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD = 12;

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");

  // The service redirects here with ?token= when the link is good and ?error= when it is not, so
  // this is the expired-link case and it has an answer: ask for another one.
  if (!token) {
    return (
      <section className="auth-panel">
        <h1>Reset your password</h1>
        <p className="auth-error">That link has expired.</p>
        <p className="auth-footer">
          <Link href="/forgot-password">Send another</Link>
        </p>
      </section>
    );
  }

  async function submit() {
    if (password.length < MIN_PASSWORD) return `Passwords are ${MIN_PASSWORD} characters or more.`;
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    return error ? "That link has expired. Ask for another." : null;
  }

  return (
    <AuthForm
      title="Choose a new password"
      submitLabel="Save password"
      onSubmit={submit}
      done="Your password is changed."
      footer={<Link href="/sign-in">Sign in</Link>}
    >
      <AuthField
        label={`New password (${MIN_PASSWORD}+ characters)`}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />
    </AuthForm>
  );
}

export default function ResetPassword() {
  return (
    <main className="page">
      {/* useSearchParams needs one, or the build refuses to prerender this route. */}
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}

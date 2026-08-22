import { env, optionalEnv } from "./env.js";

/**
 * The two emails this service sends: verify your address, and reset your password.
 *
 * Both are load-bearing rather than nice-to-have. Without the reset one, a forgotten password is a
 * permanently lost account, and everything the account holds goes with it.
 *
 * Resend's REST API directly, not their SDK. It is one POST, and a dependency that only wraps fetch
 * is a dependency to keep patched for nothing.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * With no API key, links are printed instead of sent, so local development needs no mail vendor.
 *
 * That is only ever safe locally. `assertCanSendEmail` refuses to start a service that is reachable
 * over https without a key, because there the same fallback is a password reset nobody receives and
 * a silence that looks exactly like a broken address.
 */
export function assertCanSendEmail(): void {
  const https = env("AUTH_BASE_URL").startsWith("https://");
  if (https && !optionalEnv("RESEND_API_KEY")) {
    throw new Error(
      "RESEND_API_KEY is not set, and AUTH_BASE_URL is https. Printing reset links to the log is a " +
        "local-only fallback: in production it is a password reset that never arrives.",
    );
  }
}

async function send(to: string, subject: string, body: string): Promise<void> {
  const key = optionalEnv("RESEND_API_KEY");
  if (!key) {
    console.log(`[email] to=${to} subject=${subject}\n${body}`);
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("AUTH_EMAIL_FROM"),
      to,
      subject,
      text: body,
    }),
  });

  if (!response.ok) {
    // Thrown, not swallowed. Better Auth surfaces it, and a sign-up that says it sent an email it
    // did not send is the failure worth avoiding here.
    throw new Error(`Resend refused (${response.status}): ${await response.text()}`);
  }
}

export function sendVerification(to: string, url: string): Promise<void> {
  return send(
    to,
    "Verify your SharpEyes email",
    `Confirm this address to finish setting up your SharpEyes account:\n\n${url}\n\n` +
      `If you did not sign up, ignore this email.`,
  );
}

export function sendPasswordReset(to: string, url: string): Promise<void> {
  return send(
    to,
    "Reset your SharpEyes password",
    `Set a new password for your SharpEyes account:\n\n${url}\n\n` +
      `If you did not ask for this, ignore this email and nothing changes.`,
  );
}

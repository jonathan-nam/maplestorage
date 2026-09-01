"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageSwap } from "@/components/page-swap";
import { SignInButton } from "@/components/sign-in-button";
import { ApiError, apiFetch } from "@/lib/api";
import { invitedSummary, joinCallbackPath, omittedSummary } from "@/lib/invite-link";
import { useAuth } from "@/lib/use-auth";
import type { AcceptedInvite, InvitePreview } from "@/types/invite";

// The other end of a sign-on link. Reachable signed out, which is the whole point: it has to say
// what the link gives you before you decide whether to make an account for it.
//
// The token stays in the URL across the Discord round trip rather than being stashed anywhere. It
// is already in the address that was opened, so coming back to the same address carries it, and
// there is no cookie to write and then remember to clear.

type LoadState = "loading" | "loaded" | "gone" | "error";

/** Unauthenticated. /api/join is mounted outside the authenticated block; the token is the authority. */
const noToken = () => Promise.resolve(null);

export default function JoinPage() {
  const token = String(useParams().token ?? "");
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  // The route cannot match without a segment, so the empty case is only reachable by a hand-typed
  // URL. Decided at first render rather than in the effect below: a state set synchronously in one
  // is a cascading render, and this needs no fetch to know the answer.
  const [state, setState] = useState<LoadState>(token === "" ? "gone" : "loading");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (token === "") return;
    apiFetch<InvitePreview>(`/api/join/${encodeURIComponent(token)}`, { method: "GET" }, noToken)
      .then((result) => {
        setPreview(result);
        setState("loaded");
      })
      // Unknown, expired and already used are one answer from the backend on purpose, so they are
      // one answer here too.
      .catch((e) => setState(e instanceof ApiError && e.status === 404 ? "gone" : "error"));
  }, [token]);

  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch<AcceptedInvite>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
        getToken,
      );
      // Replace, not push: the token is spent, so the back button must not return to a page
      // offering to spend it.
      router.replace("/bosses/people");
    } catch (e) {
      // The backend refuses with the reason: an account that already has characters, your own
      // link, or one made before the payload changed shape. Each is worth reading.
      setProblem(e instanceof ApiError && e.body !== "" ? e.body : "Couldn't set that up.");
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="auth-panel">
        {state === "gone" && <h1>This link has expired or was already used.</h1>}
        {state === "error" && <h1>Couldn&apos;t open this link.</h1>}

        <PageSwap
          waiting={state === "loading"}
          placeholder={<p className="party-hint">Loading...</p>}
        >
          {state === "loaded" && preview && (
            <>
              <h1>{preview.senderName} set up your parties</h1>
              <p>{preview.characters.join(", ")}</p>
              <p className="party-hint">
                {invitedSummary({
                  bosses: preview.bosses.length,
                  peopleCount: preview.peopleCount,
                })}
              </p>
              {preview.omitted.length > 0 && (
                <p className="party-hint">{omittedSummary(preview.omitted)}</p>
              )}

              {isLoaded && !isSignedIn && <SignInButton callbackPath={joinCallbackPath(token)} />}
              {isLoaded && isSignedIn && (
                <button type="button" className="party-save" disabled={busy} onClick={accept}>
                  {busy ? "Setting up..." : "Set up my account"}
                </button>
              )}
              {problem && <p className="split-error">{problem}</p>}
            </>
          )}
        </PageSwap>
      </section>
    </main>
  );
}

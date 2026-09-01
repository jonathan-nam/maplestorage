"use client";

import { useState } from "react";
import { inviteUrl } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * Makes one person a link that starts their account from your side of the parties you share.
 *
 * Two steps, because they answer different questions. First what they should see you called, which
 * only you can say: nothing on the account is a name a friend would recognise. Then the link
 * itself, which is shown once. The backend keeps only its hash, so a link that was not copied is
 * made again rather than looked up.
 */
export function InviteLink({
  person,
  defaultName,
  onCreate,
  onClose,
}: {
  person: string;
  /** Your main character, which is what a friend already knows you as. */
  defaultName: string;
  onCreate: (senderName: string) => Promise<Invite>;
  onClose: () => void;
}) {
  const [senderName, setSenderName] = useState(defaultName);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await onCreate(senderName.trim()));
    } catch {
      setError("Couldn't make a link.");
    } finally {
      setBusy(false);
    }
  }

  // The token is only ever on the response that created it, so this is the one render that can
  // show a URL. A panel reopened later starts again at the name.
  const url = invite?.token != null ? inviteUrl(window.location.origin, invite.token) : "";

  async function copy() {
    if (url === "") return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Refused without a user gesture in some browsers, and absent over plain http. The URL is on
      // screen and selectable either way, so there is nothing to report.
    }
  }

  return (
    <div className="split-result">
      {invite?.token == null ? (
        <div className="loot-actions">
          <input
            className="split-input"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Your name"
            aria-label={`What ${person} sees you called`}
            maxLength={40}
          />
          <button
            type="button"
            className="party-save"
            disabled={busy || senderName.trim() === ""}
            onClick={create}
          >
            {busy ? "Making..." : `Make a link for ${person}`}
          </button>
          <button type="button" className="party-delete" onClick={onClose}>
            Cancel
          </button>
          {error && <span className="split-error">{error}</span>}
        </div>
      ) : (
        <div className="loot-actions">
          <input
            className="split-input"
            value={url}
            readOnly
            aria-label="Link"
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="party-save" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="party-delete" onClick={onClose}>
            Done
          </button>
          <span className="party-hint">
            {invite.characterCount} characters, {invite.partyCount} parties
          </span>
        </div>
      )}
    </div>
  );
}

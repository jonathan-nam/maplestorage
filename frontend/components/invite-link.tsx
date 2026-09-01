"use client";

import { useEffect, useRef, useState } from "react";
import { inviteUrl } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * Makes one person a link that starts their account from your side of the parties you share.
 *
 * A dialog over the board rather than a panel below it. The board is as tall as its people, so a
 * panel appended underneath opened off screen for anybody with more than a couple, and the button
 * that opened it stayed exactly where it was: pressing Invite looked like it did nothing.
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
  const first = useRef<HTMLInputElement>(null);

  // Escape closes, and the focus starts inside. Both are what make this a dialog rather than a box
  // drawn on top of one: without them the page behind still has the keyboard.
  useEffect(() => {
    first.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // show a URL. A dialog reopened later starts again at the name.
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
    <div className="invite-backdrop" role="presentation" onClick={onClose}>
      {/* The click that closes belongs to the backdrop alone, so one inside the box does not travel
          out to it and shut the dialog on the way. */}
      <div
        className="invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Invite ${person}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">Invite {person}</h2>

        {invite?.token == null ? (
          <>
            <label className="invite-field">
              <span className="field-label">What {person} sees you called</span>
              <input
                ref={first}
                className="split-input"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Your name"
                maxLength={40}
              />
            </label>
            <div className="invite-actions">
              <button
                type="button"
                className="party-save"
                disabled={busy || senderName.trim() === ""}
                onClick={create}
              >
                {busy ? "Making..." : "Make a link"}
              </button>
              <button type="button" className="party-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
            {error && <p className="split-error">{error}</p>}
          </>
        ) : (
          <>
            <label className="invite-field">
              <span className="field-label">
                {invite.characterCount} characters, {invite.partyCount} parties
              </span>
              <input
                className="split-input invite-url"
                value={url}
                readOnly
                aria-label="Link"
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="invite-actions">
              <button type="button" className="party-save" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="party-cancel" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

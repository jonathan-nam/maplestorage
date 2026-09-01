"use client";

import { useEffect, useRef, useState } from "react";
import { inviteUrl } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * The link that starts one person's account from your side of the parties you share.
 *
 * One action. Pressing Invite makes the link and this shows it; there is nothing to fill in first.
 * It used to ask what the recipient should see you called, which turned a button into a form and
 * needed a label to explain why the box was there. The server takes your main character's name,
 * which is what a friend knows you by, and the recipient can rename you on their own people list
 * like anybody else.
 *
 * A dialog over the board rather than a panel below it. The board is as tall as its people, so a
 * panel appended underneath opened off screen for anybody with more than a couple, and the button
 * that opened it stayed exactly where it was: pressing Invite looked like it did nothing.
 */
export function InviteLink({
  person,
  onCreate,
  onClose,
}: {
  person: string;
  onCreate: () => Promise<Invite>;
  onClose: () => void;
}) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    // Once. The effect runs twice on a StrictMode remount, and each call spends a token and
    // replaces the link the last one made, so the URL on screen would not be the one just created.
    if (!asked.current) {
      asked.current = true;
      onCreate()
        .then(setInvite)
        .catch(() => setFailed(true));
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The token is only ever on the response that created it, so this is the one render that can show
  // a URL. A dialog opened again makes a new link rather than looking the old one up.
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

        {failed && <p className="split-error">Couldn&apos;t make a link.</p>}

        {!failed && (
          <label className="invite-field">
            <span className="field-label">
              {invite === null
                ? "Making a link..."
                : `${invite.characterCount} characters, ${invite.partyCount} parties`}
            </span>
            <input
              className="split-input invite-url"
              value={url}
              readOnly
              aria-label="Link"
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}

        <div className="invite-actions">
          {!failed && (
            <button type="button" className="party-save" disabled={invite === null} onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          )}
          <button type="button" className="party-cancel" onClick={onClose}>
            {failed ? "Close" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

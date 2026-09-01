"use client";

import { useEffect, useState } from "react";
import { inviteUrl, minutesUntil } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * One person's link: the one just made, or the one already out for them.
 *
 * The two are the same dialog because they are the same subject, and they differ in exactly what a
 * link IS. A fresh one carries its token, so it can be shown and copied. An older one does not: the
 * backend stores only a hash, so a link that was not copied is replaced rather than looked up. That
 * is why the second state offers a new link instead of the old one's address.
 *
 * There is no Revoke. A link expires on its own, and making a new one deletes the last, so nobody
 * has to remember to switch one off.
 *
 * Handed a finished invite and shows it. It does not make one, so it cannot render half of
 * anything: opening on an empty box and filling it in afterwards read as a flicker. The wait for a
 * new link lives on the button that starts it. See invitePerson.
 */
export function InviteLink({
  person,
  invite,
  busy,
  onReplace,
  onClose,
}: {
  person: string;
  invite: Invite;
  /** A replacement is being made. */
  busy: boolean;
  onReplace: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = invite.token != null ? inviteUrl(window.location.origin, invite.token) : null;
  const minutes = minutesUntil(invite.expiresAt, new Date());

  async function copy() {
    if (url === null) return;
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

        {url !== null ? (
          <label className="invite-field">
            <span className="field-label">
              {invite.characterCount} characters, {invite.partyCount} parties
            </span>
            <input
              className="split-input invite-url"
              value={url}
              readOnly
              aria-label="Link"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
          </label>
        ) : (
          // No token to show. Said as what it means for the reader rather than as the mechanism:
          // a link is out there, and this is how long until it stops on its own.
          <p className="invite-standing">
            A link is already out for {person}. It stops working in {minutes}{" "}
            {minutes === 1 ? "minute" : "minutes"}.
          </p>
        )}

        <div className="invite-actions">
          {url !== null && (
            <button type="button" className="party-save" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          )}
          {/* The only way back to a link nobody kept the address of, and the way to kill one sent
              to the wrong place: making a link deletes the one it replaces. */}
          {url === null && (
            <button type="button" className="party-save" disabled={busy} onClick={onReplace}>
              {busy ? "Making..." : "New link"}
            </button>
          )}
          <button type="button" className="party-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

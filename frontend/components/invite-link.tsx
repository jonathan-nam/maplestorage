"use client";

import { useEffect, useState } from "react";
import { inviteUrl } from "@/lib/invite-link";
import type { Invite } from "@/types/invite";

/**
 * The finished link that starts one person's account from your side of the parties you share.
 *
 * Shows a link and nothing else: it is handed one, and does not exist before there is one to hand.
 * It used to make the link itself, which meant it opened on an empty box and a "Making a link..."
 * and then swapped both for the real thing, and the swap read as a flicker. The wait lives on the
 * button that starts it now. See invitePerson.
 *
 * A dialog rather than a panel below the board. The board is as tall as its people, so a panel
 * appended underneath opened off screen for anybody with more than a couple, and the button that
 * opened it stayed exactly where it was: pressing Invite looked like it did nothing.
 */
export function InviteLink({
  person,
  invite,
  onClose,
}: {
  person: string;
  invite: Invite;
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

  // The token is only ever on the response that created it, so this is the one render that can show
  // a URL. Inviting again makes a new link rather than looking the old one up.
  const url = invite.token != null ? inviteUrl(window.location.origin, invite.token) : "";

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

        <div className="invite-actions">
          <button type="button" className="party-save" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="party-cancel" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

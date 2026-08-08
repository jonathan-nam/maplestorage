"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { RosterInputs } from "@/components/roster-inputs";
import { RosterStrip } from "@/components/roster-strip";
import { ApiError, apiAssetUrl } from "@/lib/api";
import { clearStateLabel, nextClear } from "@/lib/boss-clears";
import { poolLabel } from "@/lib/loot";
import { guaranteedDrop, otherMembers, partySizeLabel } from "@/lib/parties";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

// One config: who ran this boss this week, and what its pool is up to.
//
// The roster is editable from here, and what it edits is THIS WEEK: a week where somebody is out
// and somebody else is in is answered on the page you are already on, and the party itself is not
// disturbed by it. Taking the boss off the week is the same kind of edit, one step further, and
// leaves the config standing for the same reason. Changing the party for good is the edit page's
// job, which is why that link is still in the header.
//
// ONE line by default. The heading, the party size and the clear state answer "what is left to do
// this week", and that is what the list is scanned for; a character with a dozen bosses was a dozen
// rows of sprites to scroll past to find out. The roster is a click away rather than gone, because
// who you are running it with is the next question, not the first.
//
// The heading is passed in because it differs per view: the boss when filed by character, the
// character when filed by boss.
/** Named once so the button and the read-only span cannot word the three states apart. */
function clearClass(cleared: boolean | null): string {
  return cleared === null ? "unseen" : cleared ? "cleared" : "pending";
}

// Joins the roster to compare it, so a name cannot be mistaken for the join. It was a raw NUL byte
// in the source, which had git treating this whole file as binary and every diff of it as unreadable.
const SEP = "\0";

export function PartyCard({
  party,
  heading,
  busy,
  clear,
  onToggleClear,
  dropTable,
  onAddDrop,
  onSaveRoster,
  onTakeOff,
}: {
  party: Party;
  heading: ReactNode;
  /** THIS row's write. Fed the page's, it dimmed every row at once: the page appeared to flicker. */
  busy?: boolean;
  /**
   * The clear to draw, which is NOT always the config's own.
   *
   * On the live view it is party.cleared. On a past week the caller reads it out of that week's
   * clears instead, because /api/parties only ever answers for the period it is in. The card
   * takes it rather than reaching for party.cleared itself, so it cannot quietly draw this week's
   * state under last week's label.
   */
  clear: { cleared: boolean | null; byHand: boolean };
  /** Omitted for a read-only row: a past week is shown, not edited. */
  onToggleClear?: (cleared: boolean) => void;
  /** This party's boss's drop table, for the picker in the panel. */
  dropTable?: BossDrop[];
  /**
   * Omitted where a drop may not be added, which is any past week: the server stamps a drop with
   * today, so adding one under last week's label would file it in a week the screen is not showing.
   * Must reject when the add fails, so the row can say so.
   */
  onAddDrop?: (body: AddLootBody) => Promise<void>;
  /**
   * Sets who ran THIS week, or puts it back to the usual party with null.
   *
   * Omitted on a past week, which is shown and not edited: the server refuses to write one anyway,
   * because its payouts were pinned when its drops sold. Must reject when the save fails, so the
   * row can show the server's reason.
   */
  onSaveRoster?: (members: string[] | null) => Promise<void>;
  /**
   * Takes this boss off the period, leaving the config standing.
   *
   * Labelled Delete, which is what it does to the ROW: the config, its seats and its pool all
   * survive, and the boss is back next period. Putting it back before then is the edit page's.
   * Omitted on a past week, which is shown and not edited. Must reject when it fails, so the row
   * can say the boss is still on.
   */
  onTakeOff?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  const pool = poolLabel(party);
  // The coupon this boss drops for certain at the mode this party runs, or null.
  const guaranteed = guaranteedDrop(dropTable, party.difficulty);
  const panelId = `party-panel-${party.id}`;
  const others = otherMembers(party);
  // A solo party has no roster, but it does have a pool, so it opens too now.
  const opens =
    others.length > 0 || Boolean(onAddDrop) || Boolean(onSaveRoster) || Boolean(onTakeOff);

  const saved = others.map((m) => m.name);
  const cleaned = draft.map((m) => m.trim()).filter((m) => m !== "");
  const dirty = cleaned.join(SEP) !== saved.join(SEP);
  // Both, because `open` outlives `opens`: stepping to a past week takes the picker off a solo
  // row, and an is-open row with nothing under it is a gap below one line.
  const expanded = open && opens;

  /** Writes the week, or takes it back to the usual party with null, and closes on success. */
  async function save(members: string[] | null) {
    if (!onSaveRoster) return;
    setSaveError(null);
    try {
      await onSaveRoster(members);
      setEditing(false);
    } catch (e) {
      // The server's own reason. It is the only part of a refusal you can act on.
      setSaveError(e instanceof ApiError ? e.body : "That didn't save.");
    }
  }

  return (
    // Cleared rows step back so the list reads as what is left. Strictly `=== true`: null is "no
    // capture has said anything", which is a row that still needs an answer, not a finished one.
    <article
      className={`party-row${expanded ? " is-open" : ""}${
        clear.cleared === true ? " is-cleared" : ""
      }`}
    >
      <header className="party-row-head">
        {/* A disclosure of its own rather than the whole header, which already holds two links and
            the clear button: nesting those inside a control is not something a row can do. Absent
            on a past week for a solo config, where the panel would hold nothing at all.

            The label stopped naming the roster when the drop picker joined it below. */}
        {opens ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            // Closing drops a failed add's message with it. Kept, it would greet the next open
            // still claiming a save that is no longer being attempted.
            onClick={() => {
              setOpen((o) => !o);
              setAddError(null);
              setEditing(false);
              setSaveError(null);
              setOffError(null);
            }}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? "Hide this party" : "Show this party"}</span>
          </button>
        ) : (
          // The frame is kept so the row's heading still lines up with its neighbours'.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}
        {/* The name is the way into the party, in every grouping. It used to be plain text, which
            left a party with an empty pool reachable only by clicking the word "Duo": the badge
            below is absent until something drops, and that is exactly when you go looking for
            where to add one. Filed by party the boss chip already does this job. */}
        <Link className="party-row-heading" href={`/bosses/parties/${party.id}`}>
          {heading}
        </Link>
        <span className="party-row-label">{partySizeLabel(party.members.length)}</span>

        {/* A boss that drops vestige coupons, said with the coupon itself. A fact about the boss and
            its difficulty rather than about anything that has happened, so it does not come and go
            with what is in the pool: the pieces always drop. */}
        {guaranteed && (
          <img
            className="party-row-guaranteed"
            src={apiAssetUrl(guaranteed.iconUrl ?? "")}
            alt=""
            title={`Drops ${guaranteed.name}`}
          />
        )}

        {/* Work to do gets the line; a settled pool gets it quietly when there is none. It used
            to say nothing at all once everything was paid, which erased the pool from the row and
            left no way to tell a party with a season of drops from one that never dropped. */}
        {pool && (
          <Link
            className={pool.done ? "party-loot-summary is-done" : "party-loot-summary"}
            href={`/bosses/parties/${party.id}`}
          >
            {pool.text}
          </Link>
        )}

        {/* The clear is boss_clear's own row, the one the matrix draws and a planner capture
            writes, so ticking it here and uploading a planner are two ways of saying the same
            thing. Three states, not two: nothing said this period, said and not done, done.

            Without a handler it is still SHOWN, just not a control. A past week has an answer
            worth reading; what it does not have is one you may change from here. */}
        {onToggleClear ? (
          <button
            type="button"
            className={`party-clear is-${clearClass(clear.cleared)}`}
            disabled={busy}
            onClick={() => onToggleClear(nextClear(clear.cleared))}
            title={
              clear.cleared === null
                ? "No planner capture has mentioned this boss this period"
                : undefined
            }
          >
            {clearStateLabel(clear.cleared)}
          </button>
        ) : (
          <span className={`party-clear is-${clearClass(clear.cleared)} is-readonly`}>
            {clearStateLabel(clear.cleared)}
          </span>
        )}
      </header>

      {/* Who it is, and what it dropped, without leaving the list: logging a night used to be a
          page load per boss. Unmounted rather than hidden when closed, because a display:none
          panel is still focusable.

          The roster is the others only. Your own character is what the row is about, named in the
          heading or in the group above it, and drawing it again in every row is a column of the
          same sprite. */}
      {expanded && (
        <div id={panelId} className="party-row-panel">
          {editing && onSaveRoster ? (
            <>
              <RosterInputs members={draft} onChange={setDraft} />
              <div className="loot-actions">
                {/* The label carries the scope, so nothing else has to explain it. Saving here
                    changes the week, not the party. */}
                <button
                  type="button"
                  className="party-save"
                  disabled={busy || !dirty || cleaned.length === 0}
                  onClick={() => save(cleaned)}
                >
                  Save for this week
                </button>
                {/* Only once the week has been spelled out: there is nothing to go back to
                    otherwise, and offering it would imply the week is currently unusual. */}
                {!party.usualRoster && (
                  <button
                    type="button"
                    className="party-cancel"
                    disabled={busy}
                    onClick={() => save(null)}
                  >
                    Use the usual party
                  </button>
                )}
                <button
                  type="button"
                  className="party-cancel"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setSaveError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {saveError && <p className="split-error">{saveError}</p>}
            </>
          ) : (
            <div className="party-row-roster">
              {others.length > 0 && <RosterStrip members={others} />}
              {onSaveRoster && (
                <button
                  type="button"
                  className="party-cancel"
                  onClick={() => {
                    setDraft(saved.length > 0 ? saved : [""]);
                    setEditing(true);
                    setSaveError(null);
                  }}
                >
                  Edit
                </button>
              )}
              {/* Behind the disclosure rather than in the header, which already holds the clear
                  button: the one control pressed every week should not sit beside the one that
                  takes the row off the page. */}
              {onTakeOff && (
                <button
                  type="button"
                  className="party-delete"
                  disabled={busy}
                  onClick={async () => {
                    setOffError(null);
                    try {
                      await onTakeOff();
                    } catch {
                      setOffError("That didn't save.");
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          )}
          {/* The row is normally gone by the time this could show, so it only ever says the take-off
              did not land. */}
          {offError && <p className="split-error">{offError}</p>}
          {onAddDrop && (
            <>
              <DropPicker
                bossKey={party.bossKey}
                worldType={party.worldType}
                table={dropTable}
                difficulty={party.difficulty}
                busy={busy ?? false}
                onAdd={async (body) => {
                  setAddError(null);
                  try {
                    await onAddDrop(body);
                  } catch (e) {
                    setAddError("That didn't save.");
                    // Rethrown so the picker keeps what was chosen, ready to try again.
                    throw e;
                  }
                }}
              />
              {/* Beside the picker, so it cannot outlive the control it is about. */}
              {addError && <p className="split-error">{addError}</p>}
            </>
          )}
        </div>
      )}
    </article>
  );
}

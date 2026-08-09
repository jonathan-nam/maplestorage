"use client";

import { useState } from "react";
import { KNOWN_CHARACTERS_ID, KnownCharacters } from "@/components/known-characters";
import { RosterInputs } from "@/components/roster-inputs";
import { apiAssetUrl } from "@/lib/api";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { MAX_MINUTES, parseMinutes } from "@/lib/boss-minutes";
import { bossesWithoutConfig, otherMembers } from "@/lib/parties";
import { parseShares, sharesKey } from "@/lib/shares";
import type { Boss } from "@/types/boss";
import type { Party, SavePartyBody } from "@/types/party";

// One character's parties: a row per boss they do not solo, and who they run it with.
//
// The character leads because that is how the question gets asked ("what does mechyfechy run Kalos
// with"), and a boss with no row is a boss that character solos. Nothing has to be said for those,
// which is what keeps this down to the handful of lines that matter.

export function PartyConfigEditor({
  characterId,
  characterName,
  parties,
  bosses,
  knownCharacters,
  isSaving,
  adding,
  error,
  onSave,
  onDelete,
  onPutBack,
}: {
  characterId: string;
  characterName: string;
  parties: Party[];
  bosses: Boss[];
  /** Characters named anywhere already, for the datalist. Picking beats remembering a spelling. */
  knownCharacters: string[];
  /**
   * Whether THIS config's write is in flight, by its id. Fed one flag for the page, saving a single
   * config dimmed every row's buttons at once.
   */
  isSaving: (partyId: string) => boolean;
  /** The add form's own write. Adding one party does not lock the rows above it. */
  adding: boolean;
  error: string | null;
  onSave: (body: SavePartyBody, partyId?: string) => void;
  onDelete: (party: Party) => void;
  /** Puts a boss back on the period Party View took it off. Only that direction lives here. */
  onPutBack: (party: Party) => void;
}) {
  const [addingBoss, setAddingBoss] = useState("");
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const available = bossesWithoutConfig(parties, bosses, characterId);

  return (
    <section className="configs">
      {parties.length === 0 && (
        <p className="party-hint">
          {characterName} has no parties yet. A boss they solo needs none, so add only the ones they
          run with somebody.
        </p>
      )}

      {parties.map((party) => (
        <ConfigRow
          key={party.id}
          party={party}
          boss={bossByKey.get(party.bossKey) ?? null}
          busy={isSaving(party.id)}
          onSave={(members, difficulty, minutes, looterName, surplusName, shares) =>
            onSave(
              {
                characterId,
                bossKey: party.bossKey,
                members,
                difficulty,
                minutes,
                looterName,
                surplusName,
                shares,
              },
              party.id,
            )
          }
          onDelete={() => onDelete(party)}
          onPutBack={() => onPutBack(party)}
        />
      ))}

      {error && <p className="split-error">{error}</p>}

      <div className="loot-actions">
        <select
          className="split-input"
          value={addingBoss}
          onChange={(e) => setAddingBoss(e.target.value)}
          aria-label={`Add a boss for ${characterName}`}
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0 ? "every boss has a party" : "add a boss..."}
          </option>
          {available.map((boss) => (
            <option key={boss.bossKey} value={boss.bossKey}>
              {boss.name}
            </option>
          ))}
        </select>
        <AddParty
          busy={adding || addingBoss === ""}
          difficulties={bossByKey.get(addingBoss)?.difficulties ?? []}
          onAdd={(member, difficulty) => {
            onSave({ characterId, bossKey: addingBoss, members: [member], difficulty });
            setAddingBoss("");
          }}
          knownCharacters={knownCharacters}
        />
      </div>
    </section>
  );
}

/**
 * Adding a party takes the boss AND the first person in one go.
 *
 * The server refuses a party with nobody else in it, on purpose: that is a solo run, and a solo
 * run is not a party. So there is no such thing as an empty row to fill in afterwards.
 */
function AddParty({
  busy,
  difficulties,
  onAdd,
  knownCharacters,
}: {
  busy: boolean;
  /** The chosen boss's modes, empty until a boss is chosen. */
  difficulties: string[];
  onAdd: (member: string, difficulty: string | null) => void;
  knownCharacters: string[];
}) {
  const [member, setMember] = useState("");
  const [difficulty, setDifficulty] = useState("");
  return (
    <>
      <DifficultySelect
        difficulties={difficulties}
        value={difficulty}
        label="Difficulty for the new party"
        disabled={busy}
        onChange={setDifficulty}
      />
      <input
        className="split-input"
        value={member}
        list={KNOWN_CHARACTERS_ID}
        onChange={(e) => setMember(e.target.value)}
        placeholder="with who?"
        aria-label="First member of the new party"
        maxLength={40}
      />
      <button
        type="button"
        className="party-save"
        disabled={busy || member.trim() === ""}
        onClick={() => {
          onAdd(member.trim(), difficulty === "" ? null : difficulty);
          setMember("");
          setDifficulty("");
        }}
      >
        Add party
      </button>
      <KnownCharacters names={knownCharacters} />
    </>
  );
}

/**
 * The mode this party runs, out of the ones the boss has.
 *
 * Empty is a real answer, not a prompt to be filled in: a config can predate the column, or the
 * group may not have settled on one. It is never defaulted to Normal, which would be the app
 * saying something nobody said.
 */
function DifficultySelect({
  difficulties,
  value,
  label,
  disabled,
  onChange,
}: {
  difficulties: string[];
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (difficulty: string) => void;
}) {
  return (
    <select
      className="split-input config-difficulty"
      value={value}
      aria-label={label}
      disabled={disabled || difficulties.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">difficulty...</option>
      {difficulties.map((difficulty) => (
        <option key={difficulty} value={difficulty}>
          {difficultyLabel(difficulty)}
        </option>
      ))}
    </select>
  );
}

/**
 * How long this party takes on its boss, door to door.
 *
 * Empty is a real answer and stays one: a config nobody has timed gets the flat estimate on Run
 * Order, marked there as a guess. It is asked per config rather than per boss because the boss
 * cannot answer for it, the same Hard Lucid being twenty minutes for one party and five for a
 * stronger one.
 *
 * The box holds text rather than a number, so half-typed input is refused at the Save button
 * instead of being silently rounded into something. See parseMinutes.
 */
function RunMinutes({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (minutes: string) => void;
}) {
  return (
    <span className="config-minutes">
      <input
        className="split-input config-minutes-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MINUTES}
        step={5}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="config-minutes-unit" aria-hidden="true">
        min
      </span>
    </span>
  );
}

function ConfigRow({
  party,
  boss,
  busy,
  onSave,
  onDelete,
  onPutBack,
}: {
  party: Party;
  boss: Boss | null;
  busy: boolean;
  onSave: (
    members: string[],
    difficulty: string | null,
    minutes: number | null,
    looterName: string | null,
    surplusName: string | null,
    shares: Record<string, number>,
  ) => void;
  onDelete: () => void;
  onPutBack: () => void;
}) {
  const saved = otherMembers(party).map((m) => m.name);
  const savedDifficulty = party.difficulty ?? "";
  const savedMinutes = party.minutes === null ? "" : String(party.minutes);
  // Your own character's seat, which the roster inputs leave out because it IS the config.
  const ownName = party.members.find((m) => m.characterId === party.characterId)?.name ?? "";
  // The seat that loots, held as a NAME: it is what the save sends, and it survives the seat being
  // renamed in the same edit.
  const savedLooter = party.seats.find((s) => s.id === party.looterMemberId)?.name ?? "";
  const savedSurplus = party.seats.find((s) => s.id === party.surplusMemberId)?.name ?? "";
  const [members, setMembers] = useState<string[]>(saved.length > 0 ? saved : [""]);
  const [difficulty, setDifficulty] = useState(savedDifficulty);
  const [minutes, setMinutes] = useState(savedMinutes);
  const [looter, setLooter] = useState(savedLooter);
  const [surplus, setSurplus] = useState(savedSurplus);
  // What each seat takes, by name, as typed. Keyed by name for the same reason the looter is: it
  // is what the save sends, and it survives a seat being renamed in this same edit.
  const savedShares = Object.fromEntries(
    party.seats.filter((s) => s.shares !== 1).map((s) => [s.name, String(s.shares)]),
  );
  const [shares, setShares] = useState<Record<string, string>>(savedShares);
  // Shown only when the party is not an even split. A box per seat on every config, when nearly
  // every one is 1, is the wall of inputs #241 took off this page; a party that IS uneven has to
  // show it, because it is a number that moves money.
  const [splitting, setSplitting] = useState(Object.keys(savedShares).length > 0);
  const parsed = parseMinutes(minutes);
  const dirty =
    members.join(" ") !== saved.join(" ") ||
    difficulty !== savedDifficulty ||
    minutes !== savedMinutes ||
    looter !== savedLooter ||
    surplus !== savedSurplus ||
    sharesKey(shares) !== sharesKey(savedShares);
  // The roster as it is being edited, not as it was saved, so somebody added in this same edit can
  // be picked and a renamed seat keeps whatever it was designated for.
  const rosterNames = [ownName, ...members.map((m) => m.trim())].filter((name) => name !== "");
  const attributed = otherMembers(party).filter((m) => m.personName);
  const badShares = rosterNames.some((name) => parseShares(shares[name] ?? "") === null);

  return (
    <article className="config-row">
      <header className="config-head">
        {boss?.iconUrl && <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />}
        <h3 className="config-boss">{boss?.name ?? party.bossKey}</h3>
        <DifficultySelect
          difficulties={boss?.difficulties ?? []}
          value={difficulty}
          label={`Difficulty for ${boss?.name ?? party.bossKey}`}
          disabled={busy}
          onChange={setDifficulty}
        />
        <RunMinutes
          value={minutes}
          label={`Minutes for ${boss?.name ?? party.bossKey}`}
          disabled={busy}
          onChange={setMinutes}
        />
        {/* Named so the row is not read as a standing party that happens to be off. The two look
            identical on this page otherwise, and they revert opposite ways. */}
        {party.oneOff && <span className="party-difficulty">one-off</span>}

        {/* Where a boss that is off Party View is found again. The row is off that page entirely, so
            this is the only place it can be said, and it belongs beside Remove: one is the week, the
            other is for good.

            The wording differs because the act does. Putting a standing party back is undoing
            something you did; a one-off's week simply ended, and choosing it again is running it
            again. */}
        {party.skippedThisPeriod && (
          <button type="button" className="party-save" onClick={onPutBack} disabled={busy}>
            {party.oneOff ? "Run it again this week" : "Put back this week"}
          </button>
        )}
        <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
          Remove
        </button>
      </header>

      <RosterInputs members={members} onChange={setMembers} />

      {/* Who picks up the pieces, when the party agreed one member loots the lot. One select rather
          than a box per seat: it is one fact about the party, and it is what lets a boss marked
          cleared attribute its pieces without anybody typing them.

          Named from the roster being edited, not from the saved seats, so choosing somebody you
          added in this same edit works and a renamed seat keeps the designation. */}
      <div className="config-looter">
        {/* Named, because "the pieces" alone does not say which. The one drop this is for is
            vestige-of-erion in catalog/drops.yaml: it is the only one that arrives in a stack big
            enough that a party has to decide who picks it up. */}
        <span className="config-looter-label">Vestige of Erion</span>
        <select
          className="split-input"
          value={looter}
          onChange={(e) => setLooter(e.target.value)}
          aria-label="Who loots the Vestige of Erion pieces"
          disabled={busy}
        >
          <option value="">split, everyone loots their own</option>
          {rosterNames.map((name) => (
            <option key={name} value={name}>
              {name} loots the pieces
            </option>
          ))}
        </select>

        {/* Only where there IS an odd stack to take. A looter holds every stack, so a second
            select beside one would be a control that does nothing. */}
        {looter === "" && (
          <select
            className="split-input"
            value={surplus}
            onChange={(e) => setSurplus(e.target.value)}
            aria-label="Who takes the odd stack when a drop will not divide"
            disabled={busy}
          >
            <option value="">odd stack takes turns</option>
            {rosterNames.map((name) => (
              <option key={name} value={name}>
                {name} takes the odd stack
              </option>
            ))}
          </select>
        )}
      </div>

      {/* What each seat takes of a split, when it is not an even one.

          Type the stacks you agreed. Four and two on Extreme Kalos is 6 x 4/6 and 6 x 2/6, which is
          four stacks and two, so the numbers people say to each other go straight in. Two and one
          is the same split said shorter. */}
      <div className="config-split">
        <select
          className="split-input"
          value={splitting ? "uneven" : "even"}
          onChange={(e) => {
            const uneven = e.target.value === "uneven";
            setSplitting(uneven);
            // Back to even means back to one apiece, not a set of boxes left holding old numbers.
            if (!uneven) setShares({});
          }}
          aria-label="How this party splits a drop"
          disabled={busy}
        >
          <option value="even">even split</option>
          <option value="uneven">uneven split</option>
        </select>

        {splitting &&
          rosterNames.map((name) => (
            <label className="config-share" key={name}>
              {name}
              <input
                className="split-input"
                value={shares[name] ?? ""}
                onChange={(e) => setShares({ ...shares, [name]: e.target.value })}
                placeholder="1"
                inputMode="numeric"
                aria-label={`What ${name} takes of a split`}
                disabled={busy}
              />
            </label>
          ))}
      </div>

      {/* Whose character each one is, when the people list says so. Read-only here: it is an
          account-wide fact, kept on the People page rather than per config. */}
      {attributed.length > 0 && (
        <p className="party-hint">
          {attributed.map((m) => `${m.name} is ${m.personName}'s`).join(", ")}
        </p>
      )}

      {dirty && (
        <div className="loot-actions">
          <button
            type="button"
            className="party-save"
            disabled={busy || !parsed.ok || badShares}
            onClick={() =>
              parsed.ok &&
              !badShares &&
              onSave(
                members.map((m) => m.trim()).filter((m) => m !== ""),
                difficulty === "" ? null : difficulty,
                parsed.minutes,
                looter === "" ? null : looter,
                // A looter holds every stack, so there is no odd one and any saved answer here
                // would be a setting nothing reads.
                looter !== "" || surplus === "" ? null : surplus,
                // ALWAYS sent, never omitted. writeMembers reads a missing name as one share, so a
                // save that left this out would quietly reset every seat the party had agreed
                // otherwise for. Whole roster every time, the way the members list is.
                Object.fromEntries(
                  rosterNames.map((name) => [name, parseShares(shares[name] ?? "") ?? 1]),
                ),
              )
            }
          >
            Save
          </button>
          <button
            type="button"
            className="party-cancel"
            disabled={busy}
            onClick={() => {
              setMembers(saved.length > 0 ? saved : [""]);
              setLooter(savedLooter);
              setSurplus(savedSurplus);
              setShares(savedShares);
              setSplitting(Object.keys(savedShares).length > 0);
              setDifficulty(savedDifficulty);
              setMinutes(savedMinutes);
            }}
          >
            Revert
          </button>
        </div>
      )}
    </article>
  );
}

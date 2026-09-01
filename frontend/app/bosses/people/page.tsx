"use client";

import { PageSwap } from "@/components/page-swap";
import { InviteLink } from "@/components/invite-link";
import { PeopleBoard } from "@/components/people-board";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { liveInvite } from "@/lib/invite-link";
import { type PersonDraft, unclaimed } from "@/lib/people-board";
import { spriteByName } from "@/lib/sprite-by-name";
import type { Character } from "@/types/character";
import type { Invite } from "@/types/invite";
import type { Party, Person, SavePeopleBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PEOPLE_KEY = "/api/people";
const PARTIES_KEY = "/api/parties";
const CHARACTERS_KEY = "/api/characters";
const INVITES_KEY = "/api/invites";

// Who plays which character. Kept apart from the parties on purpose: a party names characters, and
// this says whose they are, once, for every party that names them. Say it here and CreedBratton is
// Chris's everywhere he turns up.
//
// The characters are the sprites they are in every other roster, because that is what makes the
// unclaimed pile readable: a column of unfamiliar names is the thing you cannot sort, and a column
// of faces is. Parties are fetched for the seats and for their art, own characters for the art of
// yours, which is the newer of the two. See lib/sprite-by-name.ts.
export default function PeoplePage() {
  const { getToken, isLoaded } = useAuth();

  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [draft, setDraft] = useState<PersonDraft[]>([]);
  // Which person's link is being made right now, for the length of the request only. The button
  // that started it says so; nothing else on the board changes.
  const [inviting, setInviting] = useState<string | null>(null);
  // The link the dialog is open on, which is the whole of what it shows. Null is no dialog.
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Every link this account has made, so a person with one still out is marked as such and it can
  // be taken back. Only the response that CREATED a link carries its token, so these carry none:
  // an outstanding link can be revoked or replaced, never shown again.
  const [invites, setInvites] = useState<Invite[]>(peek<Invite[]>(INVITES_KEY) ?? []);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toDraft = (rows: Person[]): PersonDraft[] =>
    rows.map((p) => ({ id: p.id, name: p.name, characters: [...p.characters] }));

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Invite[]>(INVITES_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([peopleResult, partyResult, characterResult, inviteResult]) => {
        setPeople(peopleResult);
        setDraft(toDraft(peopleResult));
        setParties(partyResult);
        setCharacters(characterResult);
        put(PEOPLE_KEY, peopleResult);
        put(PARTIES_KEY, partyResult);
        setInvites(inviteResult);
        put(CHARACTERS_KEY, characterResult);
        put(INVITES_KEY, inviteResult);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  async function save() {
    const body: SavePeopleBody = {
      people: draft
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          characters: row.characters,
        })),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Person[]>(
        PEOPLE_KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
    } catch (e) {
      // The backend refuses with the reason (see validatePeople): two people sharing a name, or
      // both claiming the same character. Both are worth reading rather than "went wrong".
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(people));

  /**
   * Makes the link, and only then opens the dialog on it.
   *
   * Not inside the dialog. Opening first and filling in afterwards put an empty box and a
   * "Making a link..." on screen for as long as the round trip took, and the swap to the real
   * link read as a flicker. A dialog whose whole content is one result should not exist before
   * the result does; the wait belongs on the button that started it.
   */
  async function invitePerson(personId: string, replace = false) {
    // A link already out is opened rather than replaced. Making one deletes the last, so pressing
    // Invite twice would silently kill a link somebody may already have been sent. Replacing it is
    // a second, deliberate press inside the dialog.
    const standing = liveInvite(invites, personId, new Date());
    if (standing !== null && !replace) {
      setInvite(standing);
      return;
    }
    setInviting(personId);
    setInviteError(null);
    try {
      const made = await apiFetch<Invite>(
        INVITES_KEY,
        { method: "POST", body: JSON.stringify({ personId }) },
        getToken,
      );
      // The created one replaces whatever this person had, exactly as the backend does.
      setInvites((held) => [made, ...held.filter((i) => i.personId !== personId || i.accepted)]);
      setInvite(made);
    } catch {
      setInviteError("Couldn't make a link.");
    } finally {
      setInviting(null);
    }
  }

  const sprites = spriteByName(characters, parties);
  const mine = characters.map((c) => c.name);
  // Against the DRAFT, not the saved list: a character dragged onto somebody has to leave the pile
  // as it is dropped, before anything is saved.
  const unassigned = unclaimed(parties, draft, mine);
  // Every character named anywhere, for the add box to complete against. The same three sources the
  // party editor uses, so a name typed here matches the one a roster already holds.
  const knownCharacters = Array.from(
    new Set([...mine, ...draft.flatMap((p) => p.characters), ...unassigned]),
  ).sort();

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties/edit">&larr; Edit Parties</Link>
      </p>
      <h1 className="page-title">Edit People</h1>

      {state === "error" && <p>Couldn&apos;t load your people.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            <PeopleBoard
              people={draft}
              unassigned={unassigned}
              knownCharacters={knownCharacters}
              spriteFor={(name) => sprites.get(name) ?? null}
              busy={busy}
              onChange={setDraft}
              onRename={(index, name) =>
                setDraft(draft.map((r, i) => (i === index ? { ...r, name } : r)))
              }
              onRemove={(index) => setDraft(draft.filter((_, i) => i !== index))}
              unsaved={dirty}
              inviting={inviting}
              invited={invites}
              onInvite={invitePerson}
            />

            {invite !== null && (
              <InviteLink
                person={invite.personName}
                invite={invite}
                busy={inviting !== null}
                onReplace={() => invitePerson(invite.personId, true)}
                onClose={() => setInvite(null)}
              />
            )}

            <div className="loot-actions">
              <button
                type="button"
                className="party-add-seat"
                onClick={() => setDraft([...draft, { name: "", characters: [] }])}
              >
                + Person
              </button>
              <button type="button" className="party-save" disabled={busy || !dirty} onClick={save}>
                {busy ? "Saving..." : "Save people"}
              </button>
              {error && <span className="split-error">{error}</span>}
              {inviteError && <span className="split-error">{inviteError}</span>}
            </div>
          </>
        )}
      </PageSwap>
    </main>
  );
}

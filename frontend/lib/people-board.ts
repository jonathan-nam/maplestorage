import type { Party } from "@/types/party";

/** One row of the People page while it is being edited. Saved as SavePeopleBody. */
export type PersonDraft = { id?: string; name: string; characters: string[] };

// The backend claims a character case-insensitively (see validatePeople), so every comparison here
// has to as well, or the page would offer a name it thinks is free and the save would refuse it.
const key = (name: string) => name.trim().toLowerCase();

/**
 * Whether a character is somebody you actually run with, as against a name that turned up once.
 *
 * Read off the app's own two flags rather than counting appearances: a seat is `guest` when it is
 * not in the party's usual roster, and a config is `oneOff` when it is on for one period rather
 * than every one. A duo partner you run a single boss with is in exactly one party and is a
 * regular, so counting parties would hide them.
 */
export function isRegular(name: string, parties: Party[]): boolean {
  const wanted = key(name);
  return parties.some(
    (party) =>
      !party.oneOff && party.seats.some((seat) => key(seat.name) === wanted && !seat.guest),
  );
}

/**
 * Every character in a party that nobody has been given, split by whether they are a regular.
 *
 * Your own are never in it. This pile asks "whose is this?", and for a character on your account
 * that is not a question: it is already answered by it being on your account.
 *
 * Both ways of knowing, because either alone leaves gaps. `mine` is your roster by name, which
 * covers a character whose seats predate the link; `seat.characterId` covers one added to a party
 * since, whose name you may have spelled differently on the roster page.
 */
export function unclaimed(
  parties: Party[],
  people: PersonDraft[],
  mine: string[] = [],
): { regular: string[]; oneOff: string[] } {
  const claimed = new Set(people.flatMap((person) => person.characters.map(key)));
  const yours = new Set(mine.map(key));
  for (const party of parties) {
    for (const seat of party.seats) {
      if (seat.characterId) yours.add(key(seat.name));
    }
  }
  // Every seat a config has ever had, not just this week's roster: somebody who has left the party
  // is still owed their share, and whose character they were is still worth saying.
  const names = new Map<string, string>();
  for (const party of parties) {
    for (const seat of party.seats) {
      const seatKey = key(seat.name);
      if (seatKey === "" || claimed.has(seatKey) || yours.has(seatKey) || names.has(seatKey)) {
        continue;
      }
      names.set(seatKey, seat.name);
    }
  }
  const sorted = [...names.values()].sort((a, b) => a.localeCompare(b));
  return {
    regular: sorted.filter((name) => isRegular(name, parties)),
    oneOff: sorted.filter((name) => !isRegular(name, parties)),
  };
}

/**
 * Gives a character to one person, or to nobody at all.
 *
 * Taken off whoever holds it first, always. A character belongs to one person, so dropping it on a
 * second one is a move rather than a second claim, and the save that would have been refused for
 * "two people claim the same character" can no longer be built.
 */
export function claim(
  people: PersonDraft[],
  name: string,
  personIndex: number | null,
): PersonDraft[] {
  if (personIndex !== null && (personIndex < 0 || personIndex >= people.length)) return people;
  const wanted = key(name);
  const stripped = people.map((person) => ({
    ...person,
    characters: person.characters.filter((character) => key(character) !== wanted),
  }));
  if (personIndex === null) return stripped;
  return stripped.map((person, index) =>
    index === personIndex ? { ...person, characters: [...person.characters, name] } : person,
  );
}

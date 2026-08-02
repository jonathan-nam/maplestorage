// Mirrors backend's parties/PartyDtos.kt field-for-field.

import type { WorldType } from "@/lib/world";

// One seat: a character somebody brought.
export type PartyMember = {
  id: string;
  name: string;
  // Whose character this is, from the people list, matched on the character name. Null means it
  // has not been attributed to anybody yet, which is ordinary.
  personId: string | null;
  personName: string | null;
  // Set when the seat is one of YOUR characters. The config's own character is always the first
  // seat, so this is set on at least one of them.
  characterId: string | null;
  spriteImgUrl: string | null;
  // Not in the party's usual roster: here for this week only, or gone from it since. Said out loud
  // because "who is in this party" and "who ran it that week" now have different answers.
  guest: boolean;
};

// One config: your character, one boss, and who they run it with. A boss your character solos has
// no config, which is why solo runs appear nowhere.
export type Party = {
  id: string;
  characterId: string;
  // The character's world. Heroic worlds do not trade, so this decides whether this pool's drops
  // can be sold at all: see lib/world.ts.
  worldType: WorldType;
  bossKey: string;
  // Which mode this party runs, one of the boss's own difficulties. Null is not NORMAL, it is
  // nobody having said yet, and nothing draws a difficulty for it.
  difficulty: string | null;
  // How long this party takes on this boss, door to door. Null is nobody having timed it, which
  // Run Order fills with a flat estimate and says so. See lib/boss-minutes.ts.
  minutes: number | null;
  // Who ran in the week being shown, your character first. Not always who usually does.
  members: PartyMember[];
  // Every seat this party has ever had, guests and departed members included. What a payout is
  // read against: a share owed to somebody who has since left is still owed, and resolving it
  // through `members` would make the drop unreadable the week after they left.
  seats: PartyMember[];
  // False when this week was spelled out with its own roster. The members alone cannot say so: a
  // week that only drops somebody names no guest and would read as an ordinary one.
  usualRoster: boolean;
  // The pool at a glance: dropped but unsold, sold with somebody still unpaid, and sold with
  // nothing left to do. The last one is carried so a fully settled pool is still visible from the
  // list rather than reading as a party that never dropped anything.
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
  // Whether this boss is cleared in the period it is currently in, straight out of boss_clear:
  // the same row the clear matrix draws and a planner capture writes. Null means nobody has said
  // anything about it this period, which is NOT the same as "not cleared".
  cleared: boolean | null;
  // Ticked here rather than read off a planner capture.
  clearedByHand: boolean;
  createdAt: string;
  updatedAt: string;
};

// A person, and the characters of theirs you have named.
export type Person = {
  id: string;
  name: string;
  characters: string[];
};

// What POST /api/parties and PUT /api/parties/{id} take. `members` is the OTHER characters: the
// config already knows whose it is.
export type SavePartyBody = {
  characterId: string;
  bossKey: string;
  members: string[];
  // One of the boss's own difficulties. Omitted or null says nothing, which the server keeps as
  // nothing; anything the boss does not have is refused rather than stored.
  difficulty?: string | null;
  // Minutes door to door, or null for "not timed". Zero is a real answer and is kept as one.
  minutes?: number | null;
};

/**
 * What PUT /api/parties/{id}/roster takes: who ran one week.
 *
 * `members` null puts the week back to the usual roster, which is a deletion rather than a copy of
 * it: a copy would freeze the week against every later change to the party.
 *
 * `week` omitted means this week, which is also the only one the server will write. It is taken
 * from the server's clock either way, so a browser a day out cannot file a roster in the wrong one.
 */
export type SaveWeekRosterBody = {
  week?: string | null;
  members: string[] | null;
};

// The whole people list, every time.
export type SavePeopleBody = {
  people: { id?: string; name: string; characters: string[] }[];
};

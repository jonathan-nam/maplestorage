// Mirrors backend's parties/PartyDtos.kt field-for-field.

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
};

// One config: your character, one boss, and who they run it with. A boss your character solos has
// no config, which is why solo runs appear nowhere.
export type Party = {
  id: string;
  characterId: string;
  bossKey: string;
  // Optional label for a shape worth naming ("carry"). Null is ordinary.
  name: string | null;
  // Your character first, then the others.
  members: PartyMember[];
  // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
  pendingLoot: number;
  awaitingPayout: number;
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
  name: string | null;
  members: string[];
};

// The whole people list, every time.
export type SavePeopleBody = {
  people: { id?: string; name: string; characters: string[] }[];
};

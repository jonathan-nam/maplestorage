// Mirrors backend's parties/PartyDtos.kt field-for-field.

// One of the people you run with. The grid's columns are these.
export type Person = {
  id: string;
  name: string;
  // Their Auction House tier. One answer per person, not per party.
  mvp: boolean;
};

export type PartyMember = {
  id: string;
  // Which person holds the seat.
  personId: string;
  // What the cell says: the character, or a label for it ("2nd mech").
  name: string;
  // The character's real name when the label is not it. What the sprite lookup and the roster
  // link use.
  ign: string | null;
  // Set when the seat is one of your characters, null when it is somebody else. This link is what
  // answers "which parties is this character in".
  characterId: string | null;
  // Whether they pay the MVP Auction House rate. A status, not a rate: the rates live in
  // lib/drop-split.ts and are read from there wherever money is worked out.
  mvp: boolean;
  // The linked character's sprite, or whatever the name lookup found. Null is ordinary: a typo or
  // an unranked character has no portrait, and the seat draws without one.
  spriteImgUrl: string | null;
};

export type Party = {
  id: string;
  // Null when never named. Label it with partyLabel(), which falls back to the roster.
  name: string | null;
  members: PartyMember[];
  // Catalog keys, in progression order. The names come from /api/bosses, the same catalog the
  // clear matrix draws its rows from.
  bossKeys: string[];
  // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
  pendingLoot: number;
  awaitingPayout: number;
  createdAt: string;
  updatedAt: string;
};

// The whole roster: columns, rows, and the character in each filled cell. Mirrors
// PartyGridResponse.
export type PartyGrid = {
  people: Person[];
  parties: Party[];
};

// What PUT /api/parties/grid takes. `key` is how a seat points at a person within one save: their
// id when they already exist, anything the client made up when they do not.
export type SavePersonBody = {
  key: string;
  id?: string;
  name: string;
  mvp: boolean;
};

export type SaveSeatBody = {
  personKey: string;
  characterName: string;
  ign?: string | null;
};

export type SavePartyBody = {
  id?: string;
  name: string | null;
  bossKeys: string[];
  seats: SaveSeatBody[];
};

export type SaveGridBody = {
  people: SavePersonBody[];
  parties: SavePartyBody[];
};

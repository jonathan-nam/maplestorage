// Mirrors backend's invites/InviteDtos.kt field-for-field.

/** A config the link could not carry, named so the drop is visible rather than inferred. */
export type InviteOmission = {
  bossKey: string;
  characterName: string;
  reason: string;
};

/**
 * A link you have made for somebody.
 *
 * `token` comes back once, on the response that created it, and never again: the backend stores
 * only its hash, so a link that was not copied is replaced rather than recovered.
 */
export type Invite = {
  id: string;
  personId: string;
  personName: string;
  senderName: string;
  token?: string | null;
  createdAt: string;
  expiresAt: string;
  accepted: boolean;
  characterCount: number;
  partyCount: number;
  omitted: InviteOmission[];
};

/** What a link offers, read without an account. */
export type InvitePreview = {
  senderName: string;
  characters: string[];
  // The configs this link seats you in, one entry each. The boss's NAME, because this page is read
  // before anyone signs in and so cannot fetch the catalog to turn a key into one.
  parties: { bossName: string; difficulty: string | null }[];
  peopleCount: number;
  omitted: InviteOmission[];
};

/** What accepting created. */
export type AcceptedInvite = {
  charactersCreated: number;
  peopleCreated: number;
  partiesCreated: number;
  omitted: InviteOmission[];
};

/** Who to make a link for. The name it is sent under is the server's to decide: see senderNameFor. */
export type CreateInviteBody = {
  personId: string;
};

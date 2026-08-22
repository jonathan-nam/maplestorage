import type { Party } from "@/types/party";

/**
 * Where a config's page is: /bosses/parties/rune/lomien, the character and the boss.
 *
 * The slug comes off the config and is never built here. Which character a name means is the
 * server's answer to give (two of yours can share one across worlds), and a second reading of it
 * on this side is a second answer to the same question. See backend PartySlug.kt.
 */
export const partyHref = (party: Pick<Party, "slug">) => `/bosses/parties/${party.slug}`;

/**
 * The same, for a row that carries only the id of the party it came off.
 *
 * Falls back to the id when that party is not in the list to hand, which the page accepts as an
 * address too: a link that reads worse is not a link to the wrong party.
 */
export const partyHrefById = (partyId: string, partyById: Map<string, Pick<Party, "slug">>) =>
  `/bosses/parties/${partyById.get(partyId)?.slug ?? partyId}`;

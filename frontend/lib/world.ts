// Which world you play in, and the three things that follow from it.
//
// Heroic (Reboot) worlds do not trade. Everything downstream of a sale is therefore Interactive
// only: the Auction House cut, the fair/lazy split, the payout roster and the Wallet. The drop log
// is not, a Heroic player still wants to know what fell.
//
// The rules live here rather than in the components so the drop-table flags are read one way in
// one place. Both of them are conditional on the world, and a component that got either backwards
// would show a plausible, confident, wrong count of what a party has to share.

/** As users.world_type, characters.world_type and drop_catalog.worlds all spell them. */
export type WorldType = "INTERACTIVE" | "HEROIC";

export const WORLD_TYPES: WorldType[] = ["INTERACTIVE", "HEROIC"];

/**
 * What to call it on screen.
 *
 * Nexon renamed Reboot to Heroic and players did not follow, so the old name is carried in
 * parentheses rather than picked over the current one.
 */
export function worldLabel(world: WorldType): string {
  return world === "HEROIC" ? "Heroic (Reboot)" : "Interactive";
}

/** Whether anything in this world can change hands. The gate on every meso figure in the app. */
export function canTrade(world: WorldType): boolean {
  return world === "INTERACTIVE";
}

/**
 * Whether this drop exists in this world.
 *
 * `worlds` is null for every drop in catalog/drops.yaml today, so nothing is narrowed at the
 * moment. The filter stays: a drop that does not exist in Reboot is a pool row that cannot happen.
 */
export function dropExistsIn(worlds: string | null, world: WorldType): boolean {
  return worlds === null || worlds === world;
}

/**
 * Whether to draw meso figures on a screen that answers for the WHOLE account.
 *
 * Takes `trades` (does any character trade), never one world, because an account can hold both and
 * the Drop Log sums across all of them. Keying this off a single stored world would hide an
 * Interactive character's real earnings behind a default nobody set.
 *
 * Undefined is the moment before the answer arrives, and it draws them: that is what every screen
 * did before this existed, and it errs towards showing rather than hiding.
 */
export function showsMoney(trades: boolean | undefined): boolean {
  return trades !== false;
}

/**
 * Whether to offer the Wallet.
 *
 * An account with no trading character cannot create a debt, so the page has nothing to answer. It
 * is still offered while a share is outstanding: money somebody is owed does not stop existing
 * because a world changed, and taking the link away over the top of it would hide what it dropped.
 */
export function offersWallet(trades: boolean | undefined, owed: boolean): boolean {
  return showsMoney(trades) || owed;
}

/**
 * Whether every member receives their own copy, so there is no one pot to divide.
 *
 * ALWAYS means everywhere. HEROIC means the party gets one in Interactive worlds and one each in
 * Heroic, which is the whole reason this takes a world: with one in hand the answer is yes or no,
 * not "it depends where you are".
 */
export function isPerMember(perMember: string | null, world: WorldType): boolean {
  return perMember === "ALWAYS" || (perMember === "HEROIC" && world === "HEROIC");
}

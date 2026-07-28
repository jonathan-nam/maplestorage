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
 * `worlds` is null for the overwhelming majority; only the three scroll coupons narrow to
 * INTERACTIVE. See catalog/drops.yaml.
 */
export function dropExistsIn(worlds: string | null, world: WorldType): boolean {
  return worlds === null || worlds === world;
}

/**
 * Whether to draw meso figures for an account.
 *
 * Takes an account's world rather than a character's, so it takes the moment before the world is
 * known: undefined draws them, which is what every screen did before this existed. A Heroic
 * account's totals are all zero, and three tiles of zeroes is Interactive machinery held up in
 * front of somebody it can never apply to.
 */
export function showsMoney(world: WorldType | undefined): boolean {
  return world !== "HEROIC";
}

/**
 * Whether to offer the Wallet.
 *
 * A Heroic account cannot create a debt, so the page has nothing to answer for them. It is still
 * offered while a share is outstanding: money somebody is owed does not stop existing because the
 * account's world changed, and taking the link away over the top of it would hide what it dropped.
 */
export function offersWallet(world: WorldType | undefined, owed: boolean): boolean {
  return showsMoney(world) || owed;
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

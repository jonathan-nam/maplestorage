"use client";

import { apiAssetUrl } from "@/lib/api";
import type { Rotation } from "@/lib/loot-rotation";

// Whose turn it is this week, for pieces that cannot change hands.
//
// The DROP heads it, with its own art, the same shape a pool row uses. It read the other way round
// first, headed "Loot this week" with the drop named underneath, and that put the instruction above
// the thing it was about: on a boss row among other drops, what this block is for is the drop.
//
// Nothing here is new markup. The head is loot-row's, and the numbers are the coupon config's, so a
// count per member reads the same wherever it appears and there is no CSS to keep in step.
//
// The accumulated balance is deliberately NOT drawn. It is fractional by construction, since a
// week's exact share of five pieces between six people is five sixths, and rounding it to "2 behind"
// would put a figure on screen that nobody told us. It orders this list and stays there.

export function LootRotation({
  rotation,
  answered,
}: {
  rotation: Rotation;
  /**
   * This week's night is already recorded, so the turn drawn below is the one after it.
   *
   * The balance counts every week answered for, tonight's included, so answering it moves the
   * rotation on the spot. Saying "this week" over the turn that answer produced would tell you to
   * undo what you had just entered.
   */
  answered: boolean;
}) {
  return (
    <div className="loot-config-card">
      <header className="loot-head">
        {rotation.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(rotation.iconUrl)} alt="" />
        ) : (
          // No official art, which is every piece the pinned dataset predates. An empty frame keeps
          // the block aligned with the ones that have it. See catalog/drops.yaml.
          <span className="loot-icon" aria-hidden="true" />
        )}
        <div className="loot-title">
          <span className="loot-name">{rotation.name}</span>
          {/* The verb earns its place. Without it these read as what already fell, which is what the
              rows above the block are, and the two numbers would be indistinguishable. */}
          <span className="loot-meta">
            Loot {rotation.quantity} {answered ? "next week" : "this week"}
          </span>
        </div>
      </header>
      <div className="config-shares">
        {rotation.holders.map((holder) => (
          <span className="config-share" key={holder.key}>
            {holder.name}
            {/* Zero is an answer: somebody's turn is to miss one, and leaving them off the list
                would read as the rotation having lost them. */}
            <span className="config-share-stacks">{holder.takes}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

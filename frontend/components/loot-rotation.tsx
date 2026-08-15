import type { Rotation } from "@/lib/loot-rotation";

// Whose turn it is this week, for pieces that cannot change hands.
//
// A name and a number each, and nothing else. A coupon block can afford to say "180 in 6 stacks of
// 30" because the stack size does not follow from the count; here one token is one piece and the
// number IS the instruction. The rotation explains itself by being on screen two weeks running.
//
// The accumulated balance is deliberately NOT drawn. It is fractional by construction, since a
// week's exact share of five pieces between six people is five sixths, and rounding it to "2
// behind" would put a figure on screen that nobody told us. It orders this list and stays there.

export function LootRotation({ rotation }: { rotation: Rotation }) {
  return (
    <div className="config-vestige">
      <span className="config-share-drop">
        {rotation.quantity} {rotation.name}
      </span>
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

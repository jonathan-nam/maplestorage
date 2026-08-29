import type { DropSectionKey } from "@/lib/drop-sections";
import { apiAssetUrl } from "@/lib/api";

/**
 * The drop the Drop Ledger's tab is marked with, looked up in the catalog's tables like any other
 * drop icon. section-mark.test.ts holds it to a drop the catalog still lists.
 *
 * Whisper of the Source was the first choice and could not be seen: its ink measures 1.45:1 against
 * the chip, last of all 34 drops, and the art is dark purple, so no size would have fixed it. The
 * grindstone is 9.89:1.
 */
export const MARK_DROP = "grindstone-of-life";

/**
 * The two marks that are not drops, as static art. See scripts/build-tab-marks.mjs for where they
 * come from and why they are not in the catalog.
 *
 * Both are the game's own sprites. Drawn glyphs were tried first, in two rounds, and read as a
 * different app's icon set however they were sized.
 */
const MARK_ART: Partial<Record<DropSectionKey, string>> = {
  sales: "/marks/money-sack.png",
  settlement: "/marks/owl-of-minerva.png",
};

/**
 * The mark a stage's tab wears, ahead of its label.
 *
 * Settled wears none. It is the one stage that asks nothing of the reader, and it already sits
 * apart at the far end of the row.
 *
 * `art` is the drop above, off the catalog's own drop tables rather than a second copy. It is null
 * while there are no tables, which is why the empty box is still drawn: DropLogSkeleton shows this
 * same strip, and a mark that arrives later would change the tab's height under the reader.
 */
export function SectionMark({ section, art }: { section: DropSectionKey; art?: string | null }) {
  if (section === "drops") {
    return art ? (
      <img className="tab-art" src={apiAssetUrl(art)} alt="" />
    ) : (
      <span className="tab-art" aria-hidden="true" />
    );
  }
  const src = MARK_ART[section];
  return src ? <img className="tab-art" src={src} alt="" /> : null;
}

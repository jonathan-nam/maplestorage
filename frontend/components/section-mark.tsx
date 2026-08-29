import type { DropSectionKey } from "@/lib/drop-sections";
import { apiAssetUrl } from "@/lib/api";

/**
 * The drop the Drop Ledger's tab is marked with, looked up in the catalog's tables like any other
 * drop icon. No ledger is about this item in particular: it is the boss set's first piece, standing
 * for what falls. section-mark.test.ts holds it to a drop the catalog still lists.
 */
export const MARK_DROP = "whisper-of-the-source";

// Every glyph below is drawn to the same live area: 14 of the 16 viewBox, filled on whichever axis
// the shape is longest on, which puts 15.8px of ink beside the sprite's 16.0px. Drawn by eye first,
// and the eye was out by 27%: the dollar sign came to 17.2px against the check's 13.5px. Measure a
// redrawn one rather than nudging it. The weight is the sheet's, once, for all three.

/**
 * The mark a stage's tab wears, ahead of its label.
 *
 * `art` is Whisper of the Source, off the catalog's own drop tables rather than a second copy. It
 * is null while there are no tables, which is why the empty box is still drawn: DropLogSkeleton
 * shows this same strip, and a mark that arrives later would change the tab's height under the
 * reader.
 */
export function SectionMark({ section, art }: { section: DropSectionKey; art?: string | null }) {
  switch (section) {
    case "drops":
      return art ? (
        <img className="tab-art" src={apiAssetUrl(art)} alt="" />
      ) : (
        <span className="tab-art" aria-hidden="true" />
      );
    case "sales":
      return (
        <svg className="tab-glyph is-money" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.9v12.2" />
          <path d="M11.4 4.6C11.4 3.3 10 2.6 8 2.6S4.6 3.4 4.6 4.9c0 1.5 1.4 2.1 3.4 2.6s3.4 1.1 3.4 2.6S10 13.4 8 13.4s-3.4-.8-3.4-2.1" />
        </svg>
      );
    // Both ways: the card nets what you are owed against what you owe.
    case "settlement":
      return (
        <svg className="tab-glyph is-between" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.9 5.8h12.2M11.2 2.9l2.9 2.9-2.9 2.9" />
          <path d="M14.1 10.2H1.9M4.8 7.3L1.9 10.2l2.9 2.9" />
        </svg>
      );
    case "settled":
      return (
        <svg className="tab-glyph is-done" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.9 8.7l4.2 4.2L14.1 4.9" />
        </svg>
      );
  }
}

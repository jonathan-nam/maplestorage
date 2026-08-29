import type { DropSectionKey } from "@/lib/drop-sections";
import { apiAssetUrl } from "@/lib/api";

/**
 * The drop the Drop Ledger's tab is marked with, looked up in the catalog's tables like any other
 * drop icon. No ledger is about this item in particular: it is the boss set's first piece, standing
 * for what falls. section-mark.test.ts holds it to a drop the catalog still lists.
 */
export const MARK_DROP = "whisper-of-the-source";

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
          <path d="M8 1.2v13.6" />
          <path d="M11.8 4.4C11.8 2.9 10.1 2 8 2S4.2 2.9 4.2 4.7c0 1.8 1.6 2.4 3.8 3s3.8 1.3 3.8 3.1S10.1 14 8 14s-3.8-.9-3.8-2.5" />
        </svg>
      );
    // Both ways: the card nets what you are owed against what you owe.
    case "settlement":
      return (
        <svg className="tab-glyph is-between" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.4 5.5h10.2M10 3l2.8 2.5L10 8" />
          <path d="M13.6 10.5H3.4M6 8l-2.8 2.5L6 13" />
        </svg>
      );
    case "settled":
      return (
        <svg className="tab-glyph is-done" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.4l3.4 3.4L13 4.6" />
        </svg>
      );
  }
}

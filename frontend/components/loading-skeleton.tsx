import { InventoryPanel } from "@/components/inventory-panel";
import { TILES_SHOWN } from "@/lib/carousel";

// Placeholder shapes shown while the characters page loads. They mirror the real layout (search
// bar, a strip of character tiles, the inventory window) so the finished UI crossfades in as one
// piece instead of assembling from empty chrome. See the skeleton styles in globals.css.

// As many tiles as the real strip shows. One more and the placeholder runs off the strip's edge,
// then settles a tile narrower when the data lands.
const TILE_COUNT = TILES_SHOWN;

export function CharactersSkeleton() {
  return (
    <div role="status" aria-label="Loading your characters">
      <section className="finder">
        <div className="finder-bar">
          <div className="skeleton sk-search" style={{ flex: 1 }} />
        </div>
      </section>

      <div className="carousel" aria-hidden="true">
        <button className="carousel-arrow" disabled aria-hidden="true" tabIndex={-1}>
          &#8249;
        </button>
        <div className="carousel-track">
          {/* The tile IS .char-tile, with shimmer standing in for the sprite and the text. As its
              own .sk-tile it measured 158px against the real tile's 188.5px: the name/level
              metrics were re-guessed and the hover-only actions row was left out entirely, so the
              inventory window below sat 30px high and dropped when the data landed. */}
          {Array.from({ length: TILE_COUNT }).map((_, i) => (
            <div className="char-tile is-skeleton" key={i}>
              <div className="sk-sprite">
                <div className="skeleton sk-sprite-figure" />
              </div>
              <div className="tile-plate">
                <div className="tile-name">
                  <span className="skeleton sk-line" style={{ width: "70%" }} />
                </div>
                <div className="tile-meta">
                  <span className="tile-level">
                    <span className="skeleton sk-line" style={{ width: "34px" }} />
                  </span>
                  <span className="tile-job">
                    <span className="skeleton sk-line" style={{ width: "52px" }} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button className="carousel-arrow" disabled aria-hidden="true" tabIndex={-1}>
          &#8250;
        </button>
      </div>

      {/* The inventory window IS the real InventoryPanel in its loading state, so its title bar,
          tabs and section grid are the same component the loaded UI renders. Nothing to keep in
          sync, and the loading and loaded windows are guaranteed identical. */}
      <InventoryPanel loading title="" items={[]} />
    </div>
  );
}

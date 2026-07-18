import { InventoryPanel } from "@/components/inventory-panel";

// Placeholder shapes shown while the characters page loads. They mirror the real layout (search
// bar, a strip of character tiles, the inventory window) so the finished UI crossfades in as one
// piece instead of assembling from empty chrome. See the skeleton styles in globals.css.

// Five tiles is enough to read as a populated strip rather than a single lonely card.
const TILE_COUNT = 5;

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
          {Array.from({ length: TILE_COUNT }).map((_, i) => (
            <div className="sk-tile" key={i}>
              <div className="skeleton sk-sprite" />
              <div className="skeleton sk-line" style={{ width: "70%" }} />
              <div className="skeleton sk-line" style={{ width: "45%" }} />
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

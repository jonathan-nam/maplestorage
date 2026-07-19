// The Storage Room chest, drawn as pixel art on a 16x16 grid.
//
// Deliberately our own art, not the client's sprite: test-fixtures/storage
// image.png is a reference for the idiom (wooden body, gold bands, red gem, heavy
// dark outline), not an asset to ship. Nothing of Nexon's is redistributed.
//
// What makes a chest read as a chest at 16px is not the wood, it's the two side
// straps and a lock straddling the lid/body seam. Everything else is detail.
//
// `open` swings the lid back and lights the inside, which is what a screenshot
// landing should feel like.

const WOOD = "#a4622d";
const WOOD_DARK = "#7a4520";
const WOOD_LIGHT = "#c98247";
const GOLD = "#f0c040";
const GOLD_DARK = "#b07d18";
const GEM = "#e8484a";
const GEM_LIGHT = "#ff9a9a";
const OUTLINE = "#2a1a10";
const GLOW = "#ffdf8a";
const GLOW_HOT = "#fff4cf";

export function Chest({ size = 32, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role="img"
      aria-label={open ? "Open storage chest" : "Storage chest"}
      style={{ display: "block" }}
    >
      {open ? (
        <>
          {/* Lid, swung back: the underside, so it reads darker than the front. */}
          <rect x="1" y="1" width="14" height="4" fill={OUTLINE} />
          <rect x="2" y="2" width="12" height="2" fill={WOOD_DARK} />
          <rect x="3" y="2" width="2" height="2" fill={GOLD_DARK} />
          <rect x="11" y="2" width="2" height="2" fill={GOLD_DARK} />

          {/* The lit interior between the lid and the body. */}
          <rect x="2" y="5" width="12" height="4" fill={OUTLINE} />
          <rect x="3" y="6" width="10" height="3" fill={GLOW} />
          <rect x="4" y="7" width="8" height="1" fill={GLOW_HOT} />
        </>
      ) : (
        <>
          {/* Lid: a shallow arch, inset a pixel at the top corners. */}
          <rect x="2" y="2" width="12" height="1" fill={OUTLINE} />
          <rect x="1" y="3" width="14" height="5" fill={OUTLINE} />
          <rect x="3" y="3" width="10" height="1" fill={WOOD_LIGHT} />
          <rect x="2" y="4" width="12" height="3" fill={WOOD} />
          <rect x="2" y="7" width="12" height="1" fill={WOOD_DARK} />

          {/* Side straps, which is what makes it read as a chest and not a crate. */}
          <rect x="3" y="3" width="2" height="5" fill={GOLD} />
          <rect x="11" y="3" width="2" height="5" fill={GOLD} />
          <rect x="4" y="3" width="1" height="5" fill={GOLD_DARK} />
          <rect x="12" y="3" width="1" height="5" fill={GOLD_DARK} />
        </>
      )}

      {/* Body: identical in both states, so the lid is the only thing that moves. */}
      <rect x="1" y="9" width="14" height="6" fill={OUTLINE} />
      <rect x="2" y="10" width="12" height="4" fill={WOOD} />
      <rect x="2" y="10" width="12" height="1" fill={WOOD_LIGHT} />
      <rect x="2" y="13" width="12" height="1" fill={WOOD_DARK} />

      {/* Body straps, continuing the lid's. */}
      <rect x="3" y="10" width="2" height="4" fill={GOLD} />
      <rect x="11" y="10" width="2" height="4" fill={GOLD} />
      <rect x="4" y="10" width="1" height="4" fill={GOLD_DARK} />
      <rect x="12" y="10" width="1" height="4" fill={GOLD_DARK} />

      {/* Feet */}
      <rect x="2" y="14" width="2" height="1" fill={GOLD_DARK} />
      <rect x="12" y="14" width="2" height="1" fill={GOLD_DARK} />

      {/* The lock, straddling the seam. Closed it holds the gem; open it hangs on
          the body alone, because the lid it clasped has swung away. */}
      {open ? (
        <>
          <rect x="6" y="10" width="4" height="3" fill={OUTLINE} />
          <rect x="7" y="11" width="2" height="1" fill={GOLD} />
        </>
      ) : (
        <>
          <rect x="6" y="7" width="4" height="5" fill={OUTLINE} />
          <rect x="7" y="8" width="2" height="3" fill={GOLD} />
          <rect x="7" y="9" width="2" height="1" fill={GEM} />
          <rect x="7" y="9" width="1" height="1" fill={GEM_LIGHT} />
        </>
      )}
    </svg>
  );
}

import { SharpEyesMark } from "./sharp-eyes-mark";

// What is on screen between picking a world and that world being drawn.
//
// Switching worlds reloads (see WorldToggle: every list and total on the page was narrowed to the
// old world by the server, and pages here fetch once on mount). Without this the reload is a dead
// moment on the old world's numbers followed by a repaint into the new one's, which reads as the
// page glitching rather than as an answer being fetched.
//
// Always rendered, shown by CSS off `html.switching-world`. That is what lets the class be set by
// the blocking script in RootLayout before first paint, so the veil is already up when the new
// document paints instead of appearing a frame into it.
//
// 64, not 60: the mark is a 32x32 sprite drawn with image-rendering pixelated, so a non-multiple
// size drops whole rows and columns. Same reason the header picks 32.
export function WorldVeil() {
  return (
    <div className="world-veil" role="status" aria-label="Switching world">
      <span className="world-veil-mark" aria-hidden="true">
        <SharpEyesMark size={64} />
      </span>
    </div>
  );
}

"use client";

import { useState } from "react";

type Os = "mac" | "windows" | "unknown";

// Capture the WHOLE game window, not a crop of the inventory panel. The window
// includes the character's name and level in the bottom-left, which is what lets
// us work out which of your characters a screenshot belongs to -- crop that away
// and you have to tell us yourself, every time.
//
// (The old copy told users to crop, and justified it with "a full game-window
// screenshot makes the item icons too small to read". That was true when
// screenshots were downscaled for a vision model. It is not true now: the game
// draws its UI at a fixed pixel size, so the icons are exactly the same size
// either way.)
const STEPS_BY_OS: Record<Os, string[]> = {
  mac: [
    "Open your inventory in-game so the items are visible.",
    "Press Cmd + Shift + 4, then press the Space bar — the cursor becomes a camera.",
    "Click the MapleStory window. It saves a PNG of the whole window to your desktop.",
    "Drag that file into the drop zone below (or click the drop zone to browse for it).",
  ],
  windows: [
    "Open your inventory in-game so the items are visible.",
    "Click the MapleStory window to make sure it's in focus, then press Alt + Print Screen — this copies the whole window to your clipboard.",
    "Click anywhere on this page and press Ctrl + V to paste it directly — no need to save a file first.",
  ],
  unknown: [
    "Open your inventory in-game so the items are visible.",
    "Capture the whole MapleStory window (Windows: Alt + Print Screen. Mac: Cmd + Shift + 4, then Space, then click the window).",
    "If it's on your clipboard, click this page and press Ctrl/Cmd + V to paste it directly.",
    "Otherwise, drag the saved image file into the drop zone below.",
  ],
};

// Best-effort detection, ported from prototypes/web-ui/script.js: User-Agent
// Client Hints where available (Chromium-only), falling back to UA parsing.
// navigator.platform is deliberately not used -- deprecated and increasingly
// unreliable. Either way this is just the default; the toggle below is what
// makes a wrong guess recoverable.
function detectOs(): Os {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) {
    if (/mac/i.test(uaData.platform)) return "mac";
    if (/win/i.test(uaData.platform)) return "windows";
    return "unknown";
  }
  const ua = navigator.userAgent || "";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows NT/i.test(ua)) return "windows";
  return "unknown";
}

export function ScreenshotHelp() {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<Os>("unknown");

  return (
    <>
      <p className="intro-copy">
        <strong>Take a screenshot of your game with your inventory open</strong> and drag it into
        the drop zone. Capture the whole game window, not just the inventory panel — the character
        name in the corner is how we tell which of your characters it belongs to, so you can drop a
        whole batch of mules at once and we&apos;ll sort them out. Don&apos;t worry about the file
        size; upload it as-is.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!open) setOs(detectOs());
            setOpen((o) => !o);
          }}
        >
          {open ? "Hide instructions" : "Don't know how to screenshot? Show me how"}
        </a>
        .
      </p>

      {open && (
        <div className="screenshot-help">
          <p className="os-toggle">
            Showing instructions for:{" "}
            {(["windows", "mac"] as const).map((candidate, i) => (
              <span key={candidate}>
                {i > 0 && " | "}
                <a
                  href="#"
                  className={os === candidate ? "active" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setOs(candidate);
                  }}
                >
                  {candidate === "windows" ? "Windows" : "Mac"}
                </a>
              </span>
            ))}
          </p>
          <ol>
            {STEPS_BY_OS[os].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="help-note">
            Cropped to just the inventory? That still works — we&apos;ll read the item counts fine —
            but there&apos;s no character name in the image, so you&apos;ll have to tell us who it
            belongs to.
          </p>
        </div>
      )}
    </>
  );
}

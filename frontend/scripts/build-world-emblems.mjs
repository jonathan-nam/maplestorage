// The world emblems on the world choice cards, as static art.
//
// The game's own world select buttons, cut down to the emblem. maplestory.io serves the wz tree at
// /api/wz/{region}/{version}/{path}, and the buttons live under
// UI.wz/Login.img/WorldSelect/worldList/release/button:{worldId}, keyed by the SAME world ids
// GmsWorld.kt pins. That is why this reads the ids from there rather than listing them again: the
// enum decides WHICH WORLDS, this file decides the size.
//
// Not UI.wz/Login.img/WorldSelect/world/{n}, which looks like the obvious source and is not. Those
// are indexed differently (0 is Scania, whose world id is 19), they are labelled in Korean, and the
// set is KMS's: Pinkbean and Burning sit in it and Hyperion does not. The `release/button:` art is
// the Global one, in English, and the `_GL` suffix on its sibling titles says so.
//
//   pnpm worlds
//
// Re-run only to add a world or bump the dataset. The output is committed, so a normal build and a
// normal CI run never touch the network. The host is slow and 504s freely, hence the retries.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "worlds");
const GMS_WORLD_KT = join(
  HERE,
  "..",
  "..",
  "backend",
  "src",
  "main",
  "kotlin",
  "com",
  "sharpeyes",
  "backend",
  "users",
  "GmsWorld.kt",
);

// catalog/build.py's ICON_VERSION, the same pin build-tab-marks.mjs uses and for the same reason:
// "latest" is whatever got extracted last and can regress an asset out from under us.
const ICON_VERSION = 268;

const WORLD_SELECT = `https://maplestory.io/api/wz/GMS/${ICON_VERSION}/UI/Login.img/WorldSelect`;
const URL_FOR = (worldId) => `${WORLD_SELECT}/worldList/release/button:${worldId}/normal/0`;

// The largest emblem in the set is Kronos at 20x17, so 20 is what lets every one of them sit 1:1.
// Raising it grows the box on the card, so raise it deliberately when an emblem needs it, and never
// as a way of making one fit. A source bigger than this is an error: see place().
const EMBLEM_CANVAS = 20;

/** The four worlds, as GmsWorld.kt declares them. Never a second list. */
async function worlds() {
  const source = await readFile(GMS_WORLD_KT, "utf8");
  const rows = [...source.matchAll(/^ {4}[A-Z]+\((\d+), "([A-Za-z]+)", WORLD_[A-Z]+\),$/gm)];
  if (rows.length === 0) throw new Error("no world rows found in GmsWorld.kt");
  return rows.map(([, worldId, displayName]) => ({
    worldId: Number(worldId),
    key: displayName.toLowerCase(),
  }));
}

/** The wz host answers 504 and 520 often enough that one attempt is not a result. */
async function fetchNode(url, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "sharpeyes-build" } });
      if (res.ok) return await res.json();
    } catch {
      // Retried below. A transport error and a 504 are the same thing to this loop.
    }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error(`could not read ${url}`);
}

/**
 * The emblem's bounds within the button.
 *
 * The button is an opaque light pill carrying an emblem and the world's name, so there is no alpha
 * to trim against: `trim()` would return the whole button. The emblem is the only SATURATED thing
 * on it, the name being grey, so the colourful bounding box is the emblem and nothing else.
 */
function emblemBox(data, { width, height, channels }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) continue;
      const hi = Math.max(r, g, b);
      const lo = Math.min(r, g, b);
      if (hi - lo > 40 && hi > 60) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("no saturated pixels: the button art is not what this expects");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The pill knocked out of the cut, so the emblem sits on the card rather than on a light chip.
 *
 * By the same test that FOUND the emblem, inverted: the pill is light and unsaturated, the emblem
 * is neither. Sampling a reference colour off the art is the version of this that did not work.
 * The button's corner pixel is transparent, because the pill has a rounded corner, so keying on it
 * knocked out everything near BLACK and took the emblems' outlines instead of the background.
 * Bera and Scania hid it: their emblems fill their bounding box, so there was no pill left inside
 * the cut to notice. Kronos and Hyperion are round and kept a white square in every corner.
 *
 * An emblem with a genuinely near-white highlight would lose it, which is why the output is looked
 * at when this is re-run and not only measured.
 */
function knockOutPill(data, info) {
  const { width, height, channels } = info;
  for (let i = 0; i < width * height * channels; i += channels) {
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    if (hi - lo <= 40 && hi >= 180) data[i + 3] = 0;
  }
  return data;
}

/** Centre on the canvas. Refuses to scale, which is the whole point of this file. */
async function place(buf, key) {
  const { width, height } = await sharp(buf).metadata();
  if (width > EMBLEM_CANVAS || height > EMBLEM_CANVAS) {
    throw new Error(
      `${key} is ${width}x${height}, larger than the ${EMBLEM_CANVAS}px canvas. Raise ` +
        `EMBLEM_CANVAS deliberately; do not scale the art.`,
    );
  }
  return sharp({
    create: {
      width: EMBLEM_CANVAS,
      height: EMBLEM_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: buf, gravity: "centre" }])
    .png()
    .toBuffer();
}

await mkdir(OUT, { recursive: true });
for (const { worldId, key } of await worlds()) {
  const node = await fetchNode(URL_FOR(worldId));
  if (!node.value) throw new Error(`button:${worldId} carries no art`);
  const button = Buffer.from(node.value, "base64");

  const { data, info } = await sharp(button)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = emblemBox(data, info);
  const cut = await sharp(knockOutPill(data, info), { raw: info }).extract(box).png().toBuffer();
  await writeFile(join(OUT, `${key}.png`), await place(cut, key));
  console.log(`${key.padEnd(10)} world ${String(worldId).padStart(2)}  ${box.width}x${box.height}`);
}

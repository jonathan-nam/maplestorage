// The Drop Log's tab marks, as static art.
//
// All three are the game's own item sprites, normalised the way catalog/build.py normalises an icon
// (trim to the art, cap the longer side, never enlarge, centre on a square canvas) but onto a 32px
// canvas rather than the catalog's 46px one. The tab draws them 1:1 at 32px, so nothing is thrown
// away. Drawing the catalog's 46px canvas in the tab instead means halving it, which is what made
// the owl an unreadable smudge: 13x16px of pale art. See MARK_CANVAS below.
//
// The grindstone is also a catalog drop, and its id is read from catalog/drops.yaml rather than
// written twice. This file decides the SIZE, the catalog decides WHICH SPRITE.
//
//   pnpm marks
//
// Re-run only to change a mark or bump the dataset. The output is committed, so a normal build and
// a normal CI run never touch the network.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "marks");
const DROPS_YAML = join(HERE, "..", "..", "catalog", "drops.yaml");

// catalog/build.py's ICON_VERSION. Pinned, not "latest", for the reason stated there: "latest" is
// whatever got extracted last and can regress an id out from under us. tab-marks.test.ts holds this
// to build.py's.
const ICON_VERSION = 268;

// Not the catalog's 46. A tab mark is drawn at its canvas size, so the canvas IS the drawn size,
// and 46 would make a 54px chip. 32 is the sprites' own size, so every one of them lands 1:1.
const MARK_CANVAS = 32;
const MARK_CONTENT = 32;

const URL_FOR = (id) => `https://maplestory.io/api/GMS/${ICON_VERSION}/item/${id}/icon`;

const MARKS = [
  // What fell. A catalog drop, so its id comes from the catalog.
  { key: "grindstone-of-life", fromCatalog: "grindstone-of-life" },
  // A sale is in mesos, and this is what mesos look like as a pile rather than a number.
  { key: "money-sack", id: 4031138, name: "Money Sack" },
  // The Free Market search owl: the game's own mark for dealing with another player, which is what
  // a settlement is.
  { key: "owl-of-minerva", id: 2310000, name: "The Owl of Minerva" },
];

/** The `icon_id` catalog/drops.yaml gives a drop, so this file never states one twice. */
async function catalogIconId(key) {
  const yaml = await readFile(DROPS_YAML, "utf8");
  const block = new RegExp(`- key: ${key}\\n(?:\\s+\\w+:.*\\n)*?\\s+icon_id: (\\d+)`).exec(yaml);
  if (!block) throw new Error(`no icon_id for ${key} in catalog/drops.yaml`);
  return Number(block[1]);
}

async function normalise(buf) {
  const trimmed = await sharp(buf)
    .ensureAlpha()
    .trim({ threshold: 0 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const longest = Math.max(width, height);
  let art = trimmed.data;
  if (longest > MARK_CONTENT) {
    const scale = MARK_CONTENT / longest;
    art = await sharp(trimmed.data)
      .resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        kernel: "lanczos3",
        fit: "fill",
      })
      .toBuffer();
  }
  return sharp({
    create: {
      width: MARK_CANVAS,
      height: MARK_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

await mkdir(OUT, { recursive: true });
for (const mark of MARKS) {
  const id = mark.id ?? (await catalogIconId(mark.fromCatalog));
  const res = await fetch(URL_FOR(id));
  if (!res.ok) throw new Error(`${mark.key} (${id}): ${res.status} from the mirror`);
  const png = await normalise(Buffer.from(await res.arrayBuffer()));
  const { width, height } = await sharp(png).metadata();
  if (width !== MARK_CANVAS || height !== MARK_CANVAS) {
    throw new Error(`${mark.key} came out ${width}x${height}, not ${MARK_CANVAS}x${MARK_CANVAS}`);
  }
  await writeFile(join(OUT, `${mark.key}.png`), png);
  console.log(`${mark.key}.png  id ${id}  ${png.length} bytes`);
}

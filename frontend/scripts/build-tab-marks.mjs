// The Drop Log tab marks that are not drops.
//
// The Drop tab wears a catalog drop, looked up at runtime like any other drop icon. These two are
// not drops and not tracked items, so they have no place in catalog/items.yaml: putting them there
// would put a trade owl in the item pickers. They are chrome, so they ship as static art here.
//
// Normalised exactly as catalog/build.py normalises an icon, because they are drawn in the same
// 46px box at the same half scale: trim to the art, cap the longer side at ICON_CONTENT, never
// enlarge, centre on a 46x46 canvas. Keep those two numbers in step with build.py.
//
//   pnpm marks
//
// Re-run only to change a mark or bump the dataset. The output is committed, so a normal build and
// a normal CI run never touch the network.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "marks");

// catalog/build.py's ICON_VERSION. Pinned, not "latest", for the reason stated there: "latest" is
// whatever got extracted last and can regress an id out from under us.
const ICON_VERSION = 268;
const ICON_CANVAS = 46;
const ICON_CONTENT = 32;
const URL_FOR = (id) => `https://maplestory.io/api/GMS/${ICON_VERSION}/item/${id}/icon`;

const MARKS = [
  // A sale is in mesos, and this is what mesos look like when they are a pile rather than a number.
  { key: "money-sack", id: 4031138, name: "Money Sack" },
  // The Free Market search owl: the game's own mark for dealing with another player, which is what
  // a settlement is.
  { key: "owl-of-minerva", id: 2310000, name: "The Owl of Minerva" },
];

async function normalise(buf) {
  const trimmed = await sharp(buf)
    .ensureAlpha()
    .trim({ threshold: 0 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const longest = Math.max(width, height);
  let art = trimmed.data;
  if (longest > ICON_CONTENT) {
    const scale = ICON_CONTENT / longest;
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
      width: ICON_CANVAS,
      height: ICON_CANVAS,
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
  const res = await fetch(URL_FOR(mark.id));
  if (!res.ok) throw new Error(`${mark.name} (${mark.id}): ${res.status} from the mirror`);
  const png = await normalise(Buffer.from(await res.arrayBuffer()));
  const { width, height } = await sharp(png).metadata();
  if (width !== ICON_CANVAS || height !== ICON_CANVAS) {
    throw new Error(`${mark.key} came out ${width}x${height}, not ${ICON_CANVAS}x${ICON_CANVAS}`);
  }
  await writeFile(join(OUT, `${mark.key}.png`), png);
  console.log(`${mark.key}.png  ${mark.name} (${mark.id})  ${png.length} bytes`);
}

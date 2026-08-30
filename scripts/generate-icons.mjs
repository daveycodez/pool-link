/**
 * Generates every icon the PWA needs from one source mark.
 *
 * The mark is Lucide's `waves-horizontal` (ISC) — the same glyph the app uses
 * for water — in the dark-theme accent over the control-room background, lit
 * from behind so it reads as the "live channel" the UI is built around.
 *
 * Run `bun run icons` after changing anything here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * The two grounds, resolved from --background in styles.css. The plated icons
 * take the light one: Android composes nothing on a launcher icon's behalf and
 * the manifest has no way to offer it a second, so the one plate that ships has
 * to be the one that survives a light launcher, a dark launcher and a circular
 * crop — and a pale plate does that where a near-black one becomes a hole.
 */
const BG_LIGHT = "#EFF7FA"; // --background, light
const BG = BG_LIGHT;

/**
 * The three accents, each the 50/50 oklab mix of a cyan and a teal at one
 * Tailwind step — the same mix `--accent` is defined as in styles.css, resolved
 * here because an SVG cannot call color-mix and a PNG cannot carry a variable.
 *
 * The app uses two of them: 600 against light backgrounds, 400 against dark.
 * The transparent icons that cannot adapt take the 500 between them, which is
 * the point of a middle step — dark enough to hold its own on a white tab
 * strip, bright enough not to disappear into a black one.
 */
const ACCENT_LIGHT = "#0095A1"; // cyan-600 + teal-600
const ACCENT_MID = "#00BAC1"; // cyan-500 + teal-500
const ACCENT_DARK = "#00D4D8"; // cyan-400 + teal-400
const ACCENT = ACCENT_DARK; // the plated icons sit on BG, so they take the dark one
const ACCENT_DEEP = "#00a8bf"; // falloff toward the bottom, like depth

/** Lucide `waves-horizontal`, 24x24 viewBox, stroke-based. */
const WAVES = [
	"M2 12q2.5 2 5 0t5 0 5 0 5 0",
	"M2 19q2.5 2 5 0t5 0 5 0 5 0",
	"M2 5q2.5 2 5 0t5 0 5 0 5 0",
];

/**
 * @param size      canvas edge in px
 * @param coverage  fraction of the canvas the 24x24 mark should span
 * @param radius    corner radius as a fraction of size (0 = full bleed)
 * @param stroke    lucide stroke width, in 24x24 units
 * @param flat      solid accent instead of the gradient; the depth falloff
 *                  costs contrast at tab sizes, where it is invisible anyway
 * @param bare      no plate behind the mark, for the icon iOS repaints itself
 * @param ink       overrides the gradient, for icons that carry no plate and so
 *                  have to be legible against a ground this file cannot see
 */
function icon({
	size,
	coverage,
	radius,
	stroke = 2,
	flat = false,
	bare = false,
	ink = null,
}) {
	const scale = (size * coverage) / 24;
	const offset = (size - 24 * scale) / 2;
	const r = size * radius;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT_DEEP}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${bare ? "" : `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#glow)"/>`}
  <g transform="translate(${offset} ${offset}) scale(${scale})"
     fill="none" stroke="${ink ?? (flat ? ACCENT : "url(#w)")}" stroke-width="${stroke}"
     stroke-linecap="round" stroke-linejoin="round">
${WAVES.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>
`;
}

const png = (svg, size, { opaque = false } = {}) => {
	let p = sharp(Buffer.from(svg)).resize(size, size);
	if (opaque) p = p.flatten({ background: BG });
	return p.png({ compressionLevel: 9 }).toBuffer();
};

/** PNG-in-ICO (valid since Vista) so /favicon.ico stops 404ing. */
function ico(entries) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	let offset = 6 + 16 * entries.length;
	const dir = [];
	for (const { size, data } of entries) {
		const e = Buffer.alloc(16);
		e.writeUInt8(size >= 256 ? 0 : size, 0);
		e.writeUInt8(size >= 256 ? 0 : size, 1);
		e.writeUInt16LE(1, 4);
		e.writeUInt16LE(32, 6);
		e.writeUInt32LE(data.length, 8);
		e.writeUInt32LE(offset, 12);
		dir.push(e);
		offset += data.length;
	}
	return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

await mkdir("public/icons", { recursive: true });

/**
 * Browser tab, twice: an SVG favicon can be swapped by the browser on theme,
 * but only by shipping one file per theme and letting the link tag's media
 * query choose — an internal @media inside a single SVG is honoured by Chrome
 * and Firefox and ignored by others, which is a coin toss rather than support.
 *
 * Both are transparent. A favicon plate is a small opaque square sitting in a
 * strip of browser chrome whose colour it can never match; the mark alone
 * always sits on the ground the browser actually drew. Sized and weighted for
 * 16-32px: nearly edge to edge with a heavier stroke, or the three waves smear
 * into a smudge.
 */
const tabSvg = (ink) =>
	icon({ bare: true, coverage: 0.9, ink, radius: 0, size: 512, stroke: 3.2 });

await writeFile("public/icon-light.svg", tabSvg(ACCENT_LIGHT));
await writeFile("public/icon-dark.svg", tabSvg(ACCENT_DARK));

/**
 * One raster mark for everywhere a theme cannot be asked about: the .ico, which
 * is a single file answering /favicon.ico for every browser and theme at once,
 * and the apple-touch-icon, which iOS repaints its own backdrop behind. Both
 * take the middle accent for the same reason — it is the one step dark enough
 * to hold a white ground and bright enough to hold a black one.
 */
const flatSvg = tabSvg(ACCENT_MID);

/**
 * Home screen on iOS, where the plate is not ours to draw any more.
 *
 * Since iOS 18 the system renders a home screen icon three ways — light, dark
 * and tinted — and composes the backdrop itself for each. An icon that carries
 * its own opaque plate opts out of all of it: the dark variant is the same
 * square in front of a wallpaper the system was going to darken anyway, and the
 * tinted one is a flat monochrome block, because the plate is most of the
 * luminance it has to work with. Transparency hands that job back.
 */
const appleSvg = icon({
	bare: true,
	coverage: 0.72,
	ink: ACCENT_MID,
	radius: 0,
	size: 512,
	stroke: 2.6,
});

// Rounded square, shown as-is by most launchers. Plated, so the mark takes the
// accent meant to be read against a light ground.
const anySvg = icon({
	coverage: 0.64,
	ink: ACCENT_LIGHT,
	radius: 0.22,
	size: 512,
});

// Maskable: launchers crop to a circle, so keep the mark inside the 80% safe
// zone and let the background run to the edge.
const maskableSvg = icon({
	coverage: 0.5,
	ink: ACCENT_LIGHT,
	radius: 0,
	size: 512,
});

const out = [
	["public/icons/icon-192.png", await png(anySvg, 192, { opaque: true })],
	["public/icons/icon-512.png", await png(anySvg, 512, { opaque: true })],
	["public/icons/maskable-192.png", await png(maskableSvg, 192, { opaque: true })],
	["public/icons/maskable-512.png", await png(maskableSvg, 512, { opaque: true })],
	["public/icons/apple-touch-icon.png", await png(appleSvg, 180)],
	[
		"public/favicon.ico",
		ico([
			{ size: 16, data: await png(flatSvg, 16) },
			{ size: 32, data: await png(flatSvg, 32) },
			{ size: 48, data: await png(flatSvg, 48) },
		]),
	],
];

for (const [path, data] of out) await writeFile(path, data);
console.log(`Wrote 2 SVGs and ${out.length} binaries.`);

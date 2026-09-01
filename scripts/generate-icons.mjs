/**
 * Generates every icon the PWA needs from one source mark.
 *
 * The mark is Lucide's `waves-horizontal` (ISC) — the same glyph the app uses
 * for water — inked in whichever accent suits the ground each icon lands on,
 * and on the plated icons lit from behind so it reads as the "live channel"
 * the UI is built around.
 *
 * Run `bun run icons` after changing anything here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * The one ground, --background from styles.css at its light value. Android
 * composes nothing on a launcher icon's behalf and the manifest has no way to
 * offer it a second, so the single plate that ships has to survive a light
 * launcher, a dark launcher and a circular crop — and a pale plate does that
 * where a near-black one becomes a hole.
 */
const BG = "#EFF7FA"; // --background, light

/**
 * The two accents, each the 50/50 oklab mix of a cyan and a teal at one Tailwind
 * step — the same two `--accent` is defined as in styles.css, at the same steps,
 * resolved here because an SVG cannot call color-mix and a PNG cannot carry a
 * variable. Light is the 600, dark is the 500; when styles.css moves a step,
 * this moves with it.
 */
const ACCENT_LIGHT = "#0095A1"; // cyan-600 + teal-600
const ACCENT_DARK = "#00BAC1"; // cyan-500 + teal-500

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
 * @param bare      no plate behind the mark, for the icon iOS repaints itself
 * @param glow      lit from behind; off for the home screen icon, which wants
 *                  the app's own background colour and nothing else
 * @param ink       the mark's colour; every caller names its own, because each
 *                  is read against a different ground this file cannot see
 */
function icon({
	size,
	coverage,
	radius,
	stroke = 2,
	bare = false,
	glow = true,
	ink,
}) {
	const scale = (size * coverage) / 24;
	const offset = (size - 24 * scale) / 2;
	const r = size * radius;
	const plate = bare
		? ""
		: `${
				glow
					? `  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${ACCENT_DARK}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${ACCENT_DARK}" stop-opacity="0"/>
    </radialGradient>
  </defs>
`
					: ""
			}  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
${
	glow
		? `  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#glow)"/>
`
		: ""
}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${plate}  <g transform="translate(${offset} ${offset}) scale(${scale})"
     fill="none" stroke="${ink}" stroke-width="${stroke}"
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
 * One raster mark for the place a theme cannot be asked about at all: the .ico,
 * a single file answering /favicon.ico for every browser and theme at once. It
 * takes the dark accent, of the two the one bright enough to hold a black
 * ground without losing a white one.
 */
const flatSvg = tabSvg(ACCENT_DARK);

/**
 * Home screen on iOS. Plated, and deliberately so.
 *
 * A transparent icon hands iOS the job of composing a backdrop, which since
 * iOS 18 it does per appearance — light, dark and tinted. That sounds like what
 * we want, and for a native app it is: the Light/Dark slots in the asset
 * catalog say which backdrop to use. A web app has no asset catalog and no way
 * to declare them, so the backdrop is chosen for us by an undocumented
 * heuristic — and on this mark it chose black, in light mode, every time.
 *
 * We tested that hard: ~20 variants of the mark, holding one property at a time.
 * Ink coverage from 4% to 57%, four colours from black to the 500, heavier
 * strokes, a centre stem, an X, a basin, solid blocks, `waves-ladder`,
 * `zodiac-aquarius`, and slices of a known-good icon spliced onto ours. Nine
 * measured properties were ruled out, several on pairs matching to three
 * decimals. Adding 1.6% ink flipped a passing icon to failing; the same waves
 * broke one passing icon and not another. There is no property to design for.
 *
 * So we draw the plate ourselves — and the appearance variants come back. iOS
 * derives the dark and tinted icons from an opaque one by working on the plate
 * it was given, so a plate in the app's own light background darkens cleanly on
 * a dark home screen. That is why the very first version of this icon looked
 * broken: it was opaque too, but its plate was already near-black (#071018), so
 * the dark variant had nothing left to darken and both modes came out the same.
 * Light plate, system does the rest.
 *
 * Full bleed: iOS applies its own squircle mask, so a radius here would only
 * round a corner that is about to be cut off anyway.
 */
const appleSvg = icon({
	coverage: 0.72,
	glow: false,
	ink: ACCENT_LIGHT,
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
	[
		"public/icons/maskable-192.png",
		await png(maskableSvg, 192, { opaque: true }),
	],
	[
		"public/icons/maskable-512.png",
		await png(maskableSvg, 512, { opaque: true }),
	],
	[
		"public/icons/apple-touch-icon.png",
		await png(appleSvg, 180, { opaque: true }),
	],
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

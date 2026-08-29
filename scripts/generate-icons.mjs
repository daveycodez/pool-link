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

const BG = "#071018"; // manifest theme_color / --background (dark)
const ACCENT = "#00d2d3"; // --accent (dark), oklch(0.78 0.14 195)
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
 */
function icon({ size, coverage, radius, stroke = 2, flat = false }) {
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
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#glow)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})"
     fill="none" stroke="${flat ? ACCENT : "url(#w)"}" stroke-width="${stroke}"
     stroke-linecap="round" stroke-linejoin="round">
${WAVES.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>
`;
}

const png = (svg, size, { opaque = false } = {}) => {
	let p = sharp(Buffer.from(svg)).resize(size, size);
	// iOS composites apple-touch-icons on white if they carry alpha, so flatten.
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

// Browser tab. Sized and weighted for 16-32px: the mark runs nearly edge to
// edge with a heavier stroke, otherwise the three waves smear into a smudge.
const faviconSvg = icon({
	size: 512,
	coverage: 0.86,
	radius: 0.16,
	stroke: 3,
	flat: true,
});
await writeFile("public/icon.svg", faviconSvg);

// Rounded square, shown as-is by most launchers and by iOS before masking.
const anySvg = icon({ size: 512, coverage: 0.64, radius: 0.22 });

// Maskable: launchers crop to a circle, so keep the mark inside the 80% safe
// zone and let the background run to the edge.
const maskableSvg = icon({ size: 512, coverage: 0.5, radius: 0 });

const out = [
	["public/icons/icon-192.png", await png(anySvg, 192)],
	["public/icons/icon-512.png", await png(anySvg, 512)],
	["public/icons/maskable-192.png", await png(maskableSvg, 192)],
	["public/icons/maskable-512.png", await png(maskableSvg, 512)],
	["public/icons/apple-touch-icon.png", await png(anySvg, 180, { opaque: true })],
	[
		"public/favicon.ico",
		ico([
			{ size: 16, data: await png(faviconSvg, 16) },
			{ size: 32, data: await png(faviconSvg, 32) },
			{ size: 48, data: await png(faviconSvg, 48) },
		]),
	],
];

for (const [path, data] of out) await writeFile(path, data);
console.log(`Wrote public/icon.svg and ${out.length} binaries.`);

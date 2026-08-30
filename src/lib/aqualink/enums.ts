/** Port of `iaqualink/systems/iaqua/enums.py`. */

export enum IaquaTemperatureUnit {
	FAHRENHEIT = "F",
	CELSIUS = "C",
}

export enum SystemStatus {
	ONLINE = "online",
	OFFLINE = "offline",
	SERVICE = "service",
	UNKNOWN = "unknown",
}

export const IaquaBinaryState = {
	OFF: "0",
	ON: "1",
} as const;

/** Heater states: 0 = off, 1 = on, 3 = enabled. */
export const IaquaHeaterState = {
	OFF: "0",
	ON: "1",
	ENABLED: "3",
} as const;

/** Jandy LED WaterColors effect ids (IaquaColorLightJL). */
/**
 * Jandy LED WaterColors effects, names and ids both from iaqualink-py. The
 * iAqualink app words three of them longer — "Slow Color Splash", "Fast Color
 * Splash", "America The Beautiful" — but these are buttons in a two-column
 * grid, and the shorter forms fit without wrapping.
 */
export const JANDY_WATERCOLORS: Record<string, number> = {
	Off: 0,
	"Alpine White": 1,
	"Sky Blue": 2,
	"Cobalt Blue": 3,
	"Caribbean Blue": 4,
	"Spring Green": 5,
	"Emerald Green": 6,
	"Emerald Rose": 7,
	Magenta: 8,
	Violet: 9,
	"Slow Splash": 10,
	"Fast Splash": 11,
	"USA!": 12,
	"Fat Tuesday": 13,
	"Disco Tech": 14,
};

/** Approximate display hex for each Jandy WaterColors effect. */
/**
 * Swatch gradients, top to bottom. Sampled from the iAqualink app's own colour
 * list so the two agree — the solid effects are a straight two-stop fit, tight
 * to a line across nine samples per disc.
 *
 * The shows sweep sideways instead, through more hues than two, so those are
 * traced across the disc rather than fitted to a line.
 */
export const WATERCOLOR_STOPS: Record<string, string[]> = {
	"Alpine White": ["#fdffff", "#b8edf4"],
	"Sky Blue": ["#f7fcfc", "#3db3d9"],
	"Cobalt Blue": ["#73c0e8", "#3678d6"],
	"Caribbean Blue": ["#a7f9e9", "#1143b0"],
	"Spring Green": ["#65d9a0", "#43963d"],
	"Emerald Green": ["#6fedf8", "#306d36"],
	"Emerald Rose": ["#a33018", "#4feaf6"],
	Magenta: ["#ff3aff", "#a822b1"],
	Violet: ["#eb9bf3", "#b842c2"],
	// The shows sweep left to right through several hues rather than holding
	// two, so these carry as many stops as it took to trace them.
	"Slow Splash": [
		"#e258e3",
		"#c052de",
		"#8f4ad6",
		"#5a43ce",
		"#293ec7",
		"#2952cb",
		"#3871d5",
		"#4891e0",
		"#537ee1",
		"#5e5fdd",
	],
	"Fast Splash": [
		"#e257e2",
		"#cc54df",
		"#9a4cd8",
		"#6344d0",
		"#303ec8",
		"#274dca",
		"#366dd4",
		"#468ede",
		"#519de5",
		"#5380e1",
		"#5e5fdd",
	],
	"USA!": [
		"#dc4d45",
		"#e27874",
		"#e9a3a1",
		"#f3d5d4",
		"#fafbfb",
		"#cacee8",
		"#9fa5dc",
		"#7880d2",
		"#4e58c7",
	],
	"Fat Tuesday": [
		"#bad3b7",
		"#d596dd",
		"#bb54c9",
		"#7a4cc2",
		"#4955ab",
		"#49876d",
		"#5eb950",
		"#a6d4a8",
		"#e2c3e8",
		"#c96ee1",
		"#9954ea",
	],
	"Disco Tech": [
		"#ab9831",
		"#74da41",
		"#6dc572",
		"#c6e7d1",
		"#9ee5ec",
		"#63cfee",
		"#5591dc",
		"#635dca",
		"#9859b2",
		"#d5579a",
	],
};

/**
 * Light `subtype` -> Jandy light family. One-based, as the panel reports it:
 * subtype 4 is `jl`, the WaterColors family this app drives. Keyed rather than
 * indexed because the array form invited reading `[4]` as `jl` when it is `ib`.
 */
export const LIGHT_SUBTYPES: Record<number, string> = {
	1: "jc",
	2: "sl",
	3: "cl",
	4: "jl",
	5: "ib",
	6: "hu",
};

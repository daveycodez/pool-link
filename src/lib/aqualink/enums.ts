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
	// ICL-only, and the one effect absent from the app screenshots — inferred
	// from the family's shape rather than sampled.
	"Ruby Red": ["#f2707a", "#b3121f"],
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

/**
 * iAquaLink Color Lights effects (flz/iaqualink-py `ICL_EFFECTS`). A different
 * table from WaterColors above, not a superset: Ruby Red sits at 8 and pushes
 * everything after it along, so the same name means a different id on each
 * family. Never reuse one table's ids for the other.
 */
export const ICL_EFFECTS: Record<string, number> = {
	Off: 0,
	"Alpine White": 1,
	"Sky Blue": 2,
	"Cobalt Blue": 3,
	"Caribbean Blue": 4,
	"Spring Green": 5,
	"Emerald Green": 6,
	"Emerald Rose": 7,
	"Ruby Red": 8,
	Magenta: 9,
	Violet: 10,
	"Slow Color Splash": 11,
	"Fast Color Splash": 12,
	"America The Beautiful": 13,
	"Fat Tuesday": 14,
	"Disco Tech": 15,
};

/** Set through the RGBW command rather than by id, so it is not in the list. */
export const ICL_CUSTOM_COLOR_ID = 16;

/** The API takes any 0-100, but the app only offers fives — so this does too. */
export const ICL_DIM_STEP = 5;

/**
 * ICL spells the three shows out where WaterColors abbreviates them. Same
 * effects, same swatches, so they alias rather than duplicate the stops.
 */
const EFFECT_ALIASES: Record<string, string> = {
	"Slow Color Splash": "Slow Splash",
	"Fast Color Splash": "Fast Splash",
	"America The Beautiful": "USA!",
};

/** Swatch stops for an effect of either family. */
export function effectStops(name: string): string[] {
	return WATERCOLOR_STOPS[EFFECT_ALIASES[name] ?? name] ?? [];
}

/**
 * Heat pump fault codes (flz/iaqualink-py `IaquaHpmErrorCode`). 13 is genuinely
 * missing from the reference list rather than omitted here.
 */
export const HPM_FAULTS: Record<string, string> = {
	"1": "Exchanger protection (cool)",
	"2": "Evaporator high temperature (cool)",
	"3": "Phase order fault",
	"4": "Cooling low pressure",
	"5": "Cooling high pressure",
	"6": "Compressor discharge temperature fault",
	"7": "Water inlet sensor fault",
	"8": "Fluid line sensor fault",
	"9": "Defrost sensor fault",
	"10": "Air inlet sensor fault",
	"11": "Compressor discharge sensor fault",
	"12": "Board communication fault",
	"14": "Electronic board overheat",
	"15": "Electrical network protection",
	"16": "Fan motor error",
	"17": "Compressor driver problem",
	"18": "Driver/compressor comms error",
	"19": "Main PCB not configured",
	"20": "Unrecognised configuration fault",
	"-1": "Unknown fault",
};

/**
 * The step the chlorinator's output stepper moves in.
 *
 * The cloud command takes any integer 0-100, but the hardware underneath does
 * not. AqualinkD, which drives the same AquaPure through the panel's own keypad
 * over RS-485, quantises every requested percent to a multiple of five
 * (`roundTo(rtn, 5)` in aq_programmer.c) for every panel family it supports,
 * and its OneTouch driver literally counts `(target - current) / 5` keypresses
 * — five is the size of one press on the pad. Jandy goes coarser still and
 * tells owners to tune in tens. Five is therefore the finest step that is real
 * everywhere, and a panel that rounds anyway tells on itself: the stepper shows
 * the value the panel echoed back, not the one it was sent.
 */
export const SWC_PERCENT_STEP = 5;

/**
 * How long a boost runs when this app starts one.
 *
 * Twenty-four hours is not an arbitrary maximum picked from the range the
 * command accepts — it is what Boost means on an AquaPure. Jandy's manual
 * defines it as 100% production for 24 hours, after which the cell returns to
 * its previous setting, and the panel reports 24 as `boostHrsVal` out of the
 * box. Shortening it would make this app's boost a different operation from
 * the one on the pad. Worth knowing: those hours count chlorinator run time,
 * not wall clock, so a pool on a pump timer takes days to spend them.
 */
export const SWC_BOOST_HOURS = 24;

/** `swcPoolStatus` / `swcSpaStatus` wire values; anything else shows raw. */
export const SWC_STATUS_LABELS: Record<string, string> = {
	standby: "Standby",
	running: "Generating",
	boosting: "Boosting",
	boostpaused: "Boost paused",
	offline: "Offline",
};

/** Set-point name -> the parameter `setpoint_hpm_temp` wants for it. */
export const HPM_TEMP_PARAM: Record<string, string> = {
	pool_set_point: "poolheatsetpointtemp",
	spa_set_point: "spaheatsetpointtemp",
	pool_chill_set_point: "poolchillsetpointtemp",
};

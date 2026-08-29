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
export const WATERCOLOR_HEX: Record<string, string> = {
	"Alpine White": "#ffffff",
	"Sky Blue": "#4db8ff",
	"Cobalt Blue": "#1f3fbf",
	"Caribbean Blue": "#00b7d4",
	"Spring Green": "#7ad15c",
	"Emerald Green": "#00945c",
	"Emerald Rose": "#e65d9e",
	Magenta: "#ff00a0",
	Violet: "#8a2be2",
	"Slow Splash": "#2a7fff",
	"Fast Splash": "#ff5a2a",
	"USA!": "#e4032a",
	"Fat Tuesday": "#6a0dad",
	"Disco Tech": "#ff3ed0",
};

/** Light `subtype` -> Jandy light family (light_subtype_to_class). */
export const LIGHT_SUBTYPES = ["jc", "sl", "cl", "jl", "ib", "hu"] as const;

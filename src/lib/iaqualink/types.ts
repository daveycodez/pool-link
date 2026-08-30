/** App view models built by normalize() from the `aqualink` port's raw data. */
import type { Raw } from "#/lib/aqualink/types";

export type { Raw };

export type DeviceKind =
	| "temperature"
	| "switch"
	| "light"
	| "dimmer"
	| "climate"
	| "pump"
	| "chlorinator"
	| "oneshot"
	| "sensor"
	| "unknown";

/**
 * A OneTouch macro: one press puts a set of equipment into a configuration the
 * owner defined on the panel. What it actually does is not knowable from here
 * — only its name, and whether it is currently the active one.
 */
export interface OneTouchMacro {
	/** `onetouch_3`, which the set command is built from. */
	name: string;
	label: string;
	on: boolean;
}

/**
 * A paired heat pump module. Absent on most panels, and when present it takes
 * over heating from the relay heaters — which is why it changes how set points
 * are written rather than only adding controls.
 */
export interface HeatPump {
	/** "off" | "enabled" | "on"; enabled counts as on. */
	status: string;
	on: boolean;
	/** "heat" | "chill". Only meaningful when `chillAvailable`. */
	mode: string;
	chillAvailable: boolean;
	/** Model string the panel reports, for the row's description. */
	type: string;
	/** Only ever present on a command's echo, never in get_home. */
	alert: string;
}

/**
 * One iAquaLink Color Lights zone. Zones are their own subsystem — addressed
 * by id, not by an aux relay — so they sit beside the devices rather than
 * among them.
 */
export interface IclZone {
	zoneId: number;
	label: string;
	on: boolean;
	/** Effect id, against ICL_EFFECTS rather than the WaterColors table. */
	colorId: number | null;
	colorName: string;
	/** Percent, in fives. */
	dim: number;
	rgbw: [number, number, number, number];
}

export interface PoolDevice {
	id: string;
	/** Physical controller name used to build set_* commands (e.g. aux_3). */
	name: string;
	label: string;
	kind: DeviceKind;
	on: boolean;
	value: string | null;
	unit: string | null;
	dimLevel: number | null;
	address: number | null;
	raw: Raw;
}

export interface PoolSnapshot {
	serial: string;
	status: string;
	fetchedAt: number;
	devices: PoolDevice[];
	/** Colour-light zones, which are not aux relays. */
	icl: IclZone[];
	/** Null unless a heat pump is paired. */
	heatPump: HeatPump | null;
	/** Configured macros only; the panel pads the list to its maximum. */
	macros: OneTouchMacro[];
	raw: Raw;
}

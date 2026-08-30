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
 * A paired salt water chlorinator (Jandy AquaPure / TruClear). Absent on most
 * panels, and unlike a relay it has no on and off: the cell runs at a percent
 * of the filter pump's run time, so what the panel reports is production, not
 * a circuit. That is why it sits beside the devices like the heat pump rather
 * than among them — there is no switch here for a device list to hold.
 *
 * Everything is nullable or empty-tolerant on purpose. This is built from a
 * `swc_info` object whose full shape has never been seen from a panel that
 * pairs a cell, so any field may be missing, and a missing field must read as
 * "not reported" rather than as a number.
 */
export interface SaltCell {
	/** Live output percent per body, which is not the same as the set point. */
	poolOutput: number | null;
	spaOutput: number | null;
	/** standby | running | boosting | boostpaused | offline, lowercased. */
	poolStatus: string;
	spaStatus: string;
	/** The panel's low-salt warning: below its floor the cell stops producing. */
	lowSalt: boolean;
	/** Whether a boost cycle is running, from the flat `swc_boost` key. */
	boosting: boolean;
	/** Configured percent, when get_home carries it alongside the object. */
	setPoint: number | null;
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
	/** Null unless the panel says a salt cell is paired. */
	saltCell: SaltCell | null;
	/** Configured macros only; the panel pads the list to its maximum. */
	macros: OneTouchMacro[];
	/**
	 * How many relays the panel's hardware has — the number in its model name,
	 * the filter pump included, so the auxiliaries number one fewer. Null when
	 * the panel does not report it or reports something that cannot be one.
	 */
	relayCount: number | null;
	raw: Raw;
}

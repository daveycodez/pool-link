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
	raw: Raw;
}

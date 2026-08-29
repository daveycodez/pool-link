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
	raw: Raw;
}

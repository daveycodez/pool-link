/** Tolerant types used by the port. */

/** Any JSON-ish record. */
export type Raw = Record<string, unknown>;

/** A flat command parameter map sent to p-api. */
export type Payload = Record<string, string>;

export interface SystemSummary {
	serial: string;
	name: string;
	status: string;
	isVSP: boolean;
	type: string;
}

/** A device's raw payload (name + parsed attributes). */
export interface DeviceData {
	name: string;
	state: string;
	label?: string;
	type?: string;
	subtype?: string;
	[key: string]: unknown;
}

export class AqualinkError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "AqualinkError";
	}
}

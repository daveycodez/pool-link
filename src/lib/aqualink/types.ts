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
		/** Parsed failure payload, when the server sent one. p-api explains
		 * rejected commands here, so it is worth keeping for diagnostics. */
		readonly body?: unknown,
	) {
		super(message);
		this.name = "AqualinkError";
	}
}

/**
 * Best available human-readable message for a failure. p-api explains rejected
 * commands in the response body — `{"error":{"message":"…"}}` — which is far
 * more useful than "Request failed (400)".
 */
export function errorMessage(e: unknown): string {
	if (!(e instanceof AqualinkError)) {
		return e instanceof Error ? e.message : String(e);
	}
	const body = e.body;
	if (typeof body === "string" && body.trim()) return body;
	if (body && typeof body === "object") {
		const { error, message } = body as Raw;
		if (typeof error === "string" && error.trim()) return error;
		if (error && typeof error === "object") {
			const nested = (error as Raw).message;
			if (typeof nested === "string" && nested.trim()) return nested;
		}
		if (typeof message === "string" && message.trim()) return message;
	}
	return e.message;
}

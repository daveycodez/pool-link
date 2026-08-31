/**
 * What survives of the port of `iaqualink/systems/iaqua/system.py`.
 *
 * The upstream package models a pad as an object graph — a system holding
 * devices that each know how to command themselves — and that whole layer used
 * to be ported here beside it. Nothing ever built one. This app reads the
 * screens as data and sends commands through `client.ts`, so the classes were a
 * second, silent implementation of every command in the app, kept honest by
 * nothing, and a reviewer had no way to tell they were unreachable. They are
 * gone; what stays is the one function the app really calls.
 */

import type { Payload, Raw } from "./types";

/** The slice of the client systems call into. */
export interface AqualinkClientLike {
	sessionRequest(
		serial: string,
		command: string,
		params?: Payload,
	): Promise<Raw>;
}

/** Collapse a home_screen/devices_screen array into a flat object. */
export function mergeScreen(arr: unknown): Raw {
	const out: Raw = {};
	if (!Array.isArray(arr)) return out;
	for (const item of arr) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		for (const [k, v] of Object.entries(item as Raw)) {
			if (Array.isArray(v)) {
				const merged: Raw = {};
				for (const sub of v) {
					if (sub && typeof sub === "object" && !Array.isArray(sub))
						Object.assign(merged, sub);
				}
				out[k] = merged;
			} else {
				out[k] = v;
			}
		}
	}
	return out;
}

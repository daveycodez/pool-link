/**
 * Port of `iaqualink/systems/iaqua/system.py` — the iaqua system.
 * Fetches the home + devices screens and exposes command helpers.
 */

import {
	CMD_GET_DEVICES,
	CMD_GET_HOME,
	CMD_SET_LIGHT,
	CMD_SET_TEMPS,
} from "./constants";
import {
	type AqualinkDevice,
	type AqualinkSystemLike,
	IaquaAuxSwitch,
	IaquaColorLight,
	IaquaHeater,
	IaquaSensor,
	IaquaSetPoint,
	IaquaSwitch,
} from "./device";
import { IaquaTemperatureUnit, SystemStatus } from "./enums";
import type { DeviceData, Payload, Raw } from "./types";

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

export class IaquaSystem implements AqualinkSystemLike {
	readonly serial: string;
	readonly name: string;
	readonly data: Raw;
	devices: Record<string, AqualinkDevice> = {};
	tempUnit: IaquaTemperatureUnit | null = null;
	status: SystemStatus = SystemStatus.UNKNOWN;

	constructor(
		private readonly client: AqualinkClientLike,
		data: { serial: string; name: string } & Raw,
	) {
		this.serial = data.serial;
		this.name = data.name;
		this.data = data;
	}

	get isVSP(): boolean {
		return this.data.isVSP === "true";
	}

	/** Pull home + devices and rebuild the device map. */
	async update(): Promise<void> {
		const [homeResp, devResp] = await Promise.all([
			this.client.sessionRequest(this.serial, CMD_GET_HOME),
			this.client.sessionRequest(this.serial, CMD_GET_DEVICES),
		]);
		this.parseHome(homeResp);
		this.parseDevices(devResp);
	}

	parseHome(response: Raw): void {
		const home = mergeScreen(response.home_screen ?? response);
		this.status =
			((home.status as string)?.toLowerCase() as SystemStatus) ??
			SystemStatus.UNKNOWN;
		this.tempUnit =
			home.temp_scale === IaquaTemperatureUnit.CELSIUS
				? IaquaTemperatureUnit.CELSIUS
				: IaquaTemperatureUnit.FAHRENHEIT;
		this.devices = {};

		for (const name of Object.keys(home)) {
			const cls = homeDeviceClass(name);
			if (!cls) continue;
			this.devices[name] = new cls(this, {
				name,
				state: String(home[name] ?? ""),
			});
		}
	}

	parseDevices(response: Raw): void {
		const dev = mergeScreen(response.devices_screen ?? response);
		for (const [name, v] of Object.entries(dev)) {
			if (!name.startsWith("aux_") || !v || typeof v !== "object") continue;
			const raw = v as Raw;
			const type = Number(raw.type);
			const subtype = Number(raw.subtype);
			const isColorLight = type === 2 && subtype >= 1;
			const data = {
				name,
				state: String(raw.state ?? ""),
				label: (raw.label as string) ?? "",
				type: String(raw.type ?? ""),
				subtype: String(raw.subtype ?? ""),
			} satisfies DeviceData;
			this.devices[name] = isColorLight
				? new IaquaColorLight(this, data)
				: new IaquaAuxSwitch(this, data);
		}
	}

	async setSwitch(command: string): Promise<Raw> {
		const r = await this.client.sessionRequest(this.serial, command);
		this.parseHome(r);
		return r;
	}

	async setAux(aux: string): Promise<Raw> {
		const r = await this.client.sessionRequest(
			this.serial,
			`set_aux_${aux.replace(/^aux_/i, "")}`,
		);
		this.parseDevices(r);
		return r;
	}

	async setLight(data: Payload): Promise<Raw> {
		const r = await this.client.sessionRequest(
			this.serial,
			CMD_SET_LIGHT,
			data,
		);
		this.parseDevices(r);
		return r;
	}

	async setTemps(spa: string, pool: string): Promise<Raw> {
		const r = await this.client.sessionRequest(this.serial, CMD_SET_TEMPS, {
			temp1: spa,
			temp2: pool,
		});
		this.parseHome(r);
		return r;
	}
}

type DeviceCtor = new (
	system: AqualinkSystemLike,
	data: DeviceData,
) => AqualinkDevice;

function homeDeviceClass(name: string): DeviceCtor | null {
	if (name.endsWith("_temp")) return IaquaSensor;
	if (name.endsWith("_set_point")) return IaquaSetPoint;
	if (name.endsWith("_heater")) return IaquaHeater;
	if (name.endsWith("_pump")) return IaquaSwitch;
	if (
		[
			"freeze_protection",
			"cover_pool",
			"ph",
			"orp",
			"pool_salinity",
			"spa_salinity",
		].includes(name)
	)
		return IaquaSensor;
	return null;
}

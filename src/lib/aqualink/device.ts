/**
 * Port of `iaqualink/systems/iaqua/device.py` — the iaqua device model.
 * Device classes hold raw attributes and drive commands through the system.
 */

import { IaquaHeaterState } from "./enums";
import type { DeviceData, Payload, Raw } from "./types";

/** The slice of a system devices call back into. */
export interface AqualinkSystemLike {
	readonly serial: string;
	setSwitch(command: string): Promise<Raw>;
	setAux(aux: string): Promise<Raw>;
	setLight(data: Payload): Promise<Raw>;
	setTemps(spa: string, pool: string): Promise<Raw>;
}

const HOME_DEVICE_LABELS: Record<string, string> = {
	spa_temp: "Spa Temperature",
	pool_temp: "Pool Temperature",
	air_temp: "Air Temperature",
	cover_pool: "Pool Cover",
	freeze_protection: "Freeze Protection",
	spa_pump: "Spa Pump",
	pool_pump: "Filter Pump",
	spa_heater: "Spa Heater",
	pool_heater: "Pool Heater",
	solar_heater: "Solar Heater",
	spa_salinity: "Spa Salinity",
	pool_salinity: "Pool Salinity",
	orp: "ORP",
	ph: "pH",
	spa_set_point: "Spa Set Point",
	pool_set_point: "Pool Set Point",
	pool_chill_set_point: "Pool Chill Set Point",
};

function humanize(name: string): string {
	return name
		.split("_")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(" ");
}

export abstract class AqualinkDevice {
	constructor(
		protected readonly system: AqualinkSystemLike,
		protected readonly data: DeviceData,
	) {}

	get name(): string {
		return this.data.name;
	}

	get label(): string {
		return (
			HOME_DEVICE_LABELS[this.name] ??
			(this.data.label ? humanize(this.data.label) : humanize(this.name))
		);
	}

	get state(): string {
		return this.data.state;
	}

	get manufacturer(): string {
		return "Jandy";
	}

	abstract get is_on(): boolean;

	abstract turn_on(): Promise<void>;
	abstract turn_off(): Promise<void>;
}

export class IaquaSensor extends AqualinkDevice {
	get is_on(): boolean {
		return false;
	}

	get value(): string {
		return this.data.state;
	}

	async turn_on(): Promise<void> {
		throw new Error(`${this.name} is read-only`);
	}
	async turn_off(): Promise<void> {
		throw new Error(`${this.name} is read-only`);
	}
}

export class IaquaSwitch extends AqualinkDevice {
	get is_on(): boolean {
		return this.state === "1";
	}

	private async toggle(): Promise<void> {
		await this.system.setSwitch(`set_${this.name}`);
	}

	async turn_on(): Promise<void> {
		if (!this.is_on) await this.toggle();
	}
	async turn_off(): Promise<void> {
		if (this.is_on) await this.toggle();
	}
}

export class IaquaHeater extends IaquaSwitch {
	get is_on(): boolean {
		return (
			this.state === IaquaHeaterState.ON ||
			this.state === IaquaHeaterState.ENABLED
		);
	}
}

export class IaquaAuxSwitch extends AqualinkDevice {
	get is_on(): boolean {
		return this.state === "1";
	}

	private async toggle(): Promise<void> {
		await this.system.setAux(this.name);
	}

	async turn_on(): Promise<void> {
		if (!this.is_on) await this.toggle();
	}
	async turn_off(): Promise<void> {
		if (this.is_on) await this.toggle();
	}
}

/** A Jandy (or other) color light; on/off is effect id 1/0. */
export class IaquaColorLight extends IaquaAuxSwitch {
	private async setEffect(effectId: number): Promise<void> {
		await this.system.setLight({
			aux: this.name.replace(/^aux_/i, ""),
			light: String(effectId),
			subtype: this.data.subtype ?? "",
		});
	}

	async turn_on(): Promise<void> {
		if (!this.is_on) await this.setEffect(1);
	}
	async turn_off(): Promise<void> {
		if (this.is_on) await this.setEffect(0);
	}
}

export class IaquaSetPoint extends AqualinkDevice {
	get is_on(): boolean {
		return false;
	}

	get value(): string {
		return this.data.state;
	}

	async setValue(value: string): Promise<void> {
		await this.system.setTemps(
			this.name.startsWith("spa") ? value : "",
			this.name.startsWith("pool") ? value : "",
		);
	}

	async turn_on(): Promise<void> {
		throw new Error(`${this.name} is a set point`);
	}
	async turn_off(): Promise<void> {
		throw new Error(`${this.name} is a set point`);
	}
}

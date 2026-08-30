import type {
	DeviceKind,
	IclZone,
	PoolDevice,
	PoolSnapshot,
	Raw,
} from "./types";

/**
 * Physical device taxonomy for Jandy iAqualink (from flz/iaqualink-py
 * `_HOME_DEVICE_MAP` + PoolPilot). The home_screen from p-api uses these exact
 * keys, so a flat dict maps straight onto friendly labels/kinds.
 */
const KNOWN_LABELS: Record<string, string> = {
	pool_temp: "Pool",
	spa_temp: "Spa",
	air_temp: "Air",
	pool_set_point: "Pool Set Point",
	spa_set_point: "Spa Set Point",
	pool_chill_set_point: "Pool Chill Set Point",
	pool_pump: "Filter Pump",
	spa_pump: "Spa Mode",
	pool_heater: "Pool Heater",
	spa_heater: "Spa Heater",
	solar_heater: "Solar Heater",
	freeze_protection: "Freeze Protection",
	cover_pool: "Pool Cover",
	pool_salinity: "Pool Salinity",
	spa_salinity: "Spa Salinity",
	orp: "ORP",
	ph: "pH",
};

function knownKind(name: string): DeviceKind | null {
	if (name.endsWith("_temp")) return "temperature";
	if (name.endsWith("_set_point")) return "climate";
	if (name.endsWith("_heater")) return "climate";
	if (name.endsWith("_pump")) return "pump";
	if (name.startsWith("aux_")) return "switch";
	if (name.includes("salinity") || name === "orp" || name === "ph")
		return "sensor";
	return null;
}

/** Friendly label for an aux relay (aux_3 → "Aux 3"). */
function auxLabel(name: string): string {
	const n = name.match(/^aux_(\w+)$/i)?.[1];
	return n ? `Aux ${n}` : "";
}

function str(v: unknown): string | null {
	if (typeof v === "string" && v.trim()) return v;
	if (typeof v === "number") return String(v);
	return null;
}

function num(v: unknown): number | null {
	const n = typeof v === "string" ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function isOn(v: unknown): boolean {
	const s = str(v)?.toLowerCase();
	return (
		s === "on" || s === "true" || s === "1" || s === "yes" || s === "active"
	);
}

/** Heater on = state 1 (on) or 3 (enabled). */
function heaterOn(v: unknown): boolean {
	const s = str(v);
	return s === "1" || s === "3";
}

/** Build a device from a flat `{name, state, label?, type?, subtype?}` entry. */
function buildDevice(name: string, raw: Raw): PoolDevice | null {
	const state = raw.state ?? raw.status ?? raw.value;
	const label = str(raw.label) ?? KNOWN_LABELS[name] ?? auxLabel(name) ?? name;

	const type = num(raw.type);
	let kind: DeviceKind;
	if (type === 2) kind = "light";
	else if (name.endsWith("_temp")) kind = "temperature";
	else if (name.endsWith("_set_point")) kind = "climate";
	else if (name.endsWith("_heater")) kind = "climate";
	else if (name.endsWith("_pump")) kind = "pump";
	else if (name.startsWith("aux_")) kind = "switch";
	else kind = knownKind(name) ?? "switch";

	const isHeater = kind === "climate" && name.endsWith("_heater");
	const isSetPoint = kind === "climate" && name.endsWith("_set_point");

	return {
		id: name,
		name,
		label,
		kind,
		on: isHeater ? heaterOn(state) : isSetPoint ? false : isOn(state),
		// Sensors carry a reading too — chemistry, not degrees, so no unit.
		value:
			kind === "temperature" || kind === "sensor" || isSetPoint
				? str(state)
				: null,
		unit: kind === "temperature" || isSetPoint ? "°" : null,
		dimLevel: num(raw.dim_level),
		address: num(raw.address ?? raw.slot_id),
		raw,
	};
}

/**
 * Zones report their own state, so nothing here is inferred: `zoneStatus` says
 * on or off, `zoneColor` is an id against ICL_EFFECTS, and the RGBW channels
 * carry whatever a custom colour was set to.
 */
function buildZones(icl: unknown): IclZone[] {
	if (!Array.isArray(icl)) return [];
	return icl.map((raw) => {
		const z = raw as Raw;
		const id = num(z.zoneId) ?? 0;
		const color = num(z.zoneColor);
		return {
			zoneId: id,
			label: str(z.zoneName) || `Light Zone ${id}`,
			on: String(z.zoneStatus ?? "").toLowerCase() === "on",
			colorId: color,
			colorName: str(z.zoneColorVal) ?? "",
			dim: num(z.dim_level) ?? 100,
			rgbw: [
				num(z.red_val) ?? 0,
				num(z.green_val) ?? 0,
				num(z.blue_val) ?? 0,
				num(z.white_val) ?? 0,
			] as [number, number, number, number],
		};
	});
}

export function normalize(
	serial: string,
	home: Raw,
	devices: Raw,
	icl?: unknown,
): PoolSnapshot {
	const merged: Raw = { ...home, ...devices };
	const out: PoolDevice[] = [];

	for (const [name, v] of Object.entries(merged)) {
		const known =
			knownKind(name) !== null || KNOWN_LABELS[name] || name.startsWith("aux_");
		if (!known) continue;
		const raw =
			v && typeof v === "object" && !Array.isArray(v)
				? { ...(v as Raw), name }
				: { name, state: v };
		const d = buildDevice(name, raw);
		if (d) out.push(d);
	}

	return {
		serial,
		status: str(merged.status)?.toLowerCase() ?? "unknown",
		fetchedAt: Date.now(),
		devices: out,
		icl: buildZones(icl),
		raw: merged,
	};
}

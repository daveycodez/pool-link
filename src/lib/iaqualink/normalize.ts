import {
	AUX_TYPE_COLOR_LIGHT,
	AUX_TYPE_DIMMER,
	DIMMER_STEP,
} from "#/lib/aqualink/enums";
import type {
	DeviceKind,
	HeatPump,
	IclZone,
	OneTouchMacro,
	PoolDevice,
	PoolSnapshot,
	Raw,
	SaltCell,
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
	// The chlorinator's keys are a percentage subsystem, read by buildSaltCell,
	// and none of them is a device. This guard is what stops `swc_set_point`
	// falling through to the suffix rule below and becoming a climate device —
	// an unlabelled row reporting a chlorine percentage in degrees, on any panel
	// that reports the key. It has to come first: the suffix rules match on
	// shape alone and cannot tell a percent from a temperature.
	if (name.startsWith("swc_")) return null;
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

/**
 * A dimming relay's current level, from the field that carries it.
 *
 * `subtype` is the panel's most overloaded field: on a colour light it names the
 * light's brand, on a plain relay it carries a VSP assignment flag, and only on
 * a dimming relay is it a level at all. Every relay reports one — this pool's
 * configured pair say 0 and its virtual slots say 2, none of them dimmers — so
 * this must never be reached without checking `type` first, or a waterfall reads
 * as lit to 2%.
 *
 * Unverified, and the least certain thing in this file. No capture of a dimming
 * relay exists anywhere public; iaqualink-py reads this field as a percentage on
 * the strength of its own comment and has no dimmer fixture in its tests. The
 * complication is that the panel's own encoding for a classic dimmer is a mode
 * index — 0 to 4 across the five names it holds instead of numbers — and
 * AqualinkD, driving the same relay directly, converts between index and percent
 * explicitly ("value or Dimmer2 is the actual %, while Dimmer & colorlight is an
 * index into an array"). Which of the two the cloud echoes back here is unknown.
 *
 * So both are read, which is free because they cannot collide: a real level is a
 * multiple of 25, so anything in 1-4 can only be an index, and anything from 25
 * up can only be a percentage. 0 is off under either reading. No value is legal
 * in one encoding and silently wrong in the other — this costs nothing if
 * iaqualink-py is right, and saves a fully-lit relay reading 4% if it is not.
 */
function dimmerLevel(raw: Raw): number | null {
	// A blank field parses as 0, which here would be the relay saying it is off
	// rather than saying nothing — the same trap the chlorinator's `percent`
	// guards, and worth guarding for the same reason: a level of 0 is a fact,
	// and "not reported" must not be able to impersonate one.
	if (typeof raw.subtype === "string" && !raw.subtype.trim()) return null;
	const n = num(raw.subtype);
	if (n === null || n < 0) return null;
	return Math.min(100, Math.round(n > 0 && n <= 4 ? n * DIMMER_STEP : n));
}

/** Build a device from a flat `{name, state, label?, type?, subtype?}` entry. */
function buildDevice(name: string, raw: Raw): PoolDevice | null {
	const state = raw.state ?? raw.status ?? raw.value;
	const label = str(raw.label) ?? KNOWN_LABELS[name] ?? auxLabel(name) ?? name;

	const type = num(raw.type);
	let kind: DeviceKind;
	if (type === AUX_TYPE_COLOR_LIGHT) kind = "light";
	else if (type === AUX_TYPE_DIMMER) kind = "dimmer";
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
		// Only a dimming relay has a level, and only it reads `subtype` as one.
		// This used to read `dim_level`, which is the ICL zones' field — buildZones
		// still reads it there, correctly — and which no aux has ever carried, so
		// the value was permanently null and the percentage the equipment row
		// prints from it was unreachable code.
		dimLevel: kind === "dimmer" ? dimmerLevel(raw) : null,
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

/**
 * get_home spells these lowercase; the three HPM write commands echo the same
 * data back in HPMxxx casing. Both are accepted, or a command's response would
 * read as "no heat pump" and the row would vanish mid-interaction.
 */
function buildHeatPump(raw: unknown): HeatPump | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const hp = raw as Raw;
	const cased = "isHPMPresent" in hp;
	const present = cased ? hp.isHPMPresent : hp.isheatpumpPresent;
	if (!present || String(present).toLowerCase() === "false") return null;

	const status = str(cased ? hp.HPMstatus : hp.heatpumpstatus) ?? "";
	return {
		status,
		// "enabled" means paired and ready; the panel uses it alongside "on".
		on: ["on", "enabled"].includes(status.toLowerCase()),
		mode: str(cased ? hp.HPMmode : hp.heatpumpmode) ?? "",
		chillAvailable: Boolean(hp.isChillAvailable),
		type: str(cased ? hp.HPMtype : hp.heatpumptype) ?? "",
		alert: str(hp.alert_message) ?? "",
	};
}

/**
 * A panel's own word for "no", in every spelling one has been seen using. The
 * home screen mixes JSON booleans with the strings it renders them as, so a
 * bare truthiness test reads `"false"` and `"0"` as yes.
 */
function isNo(v: unknown): boolean {
	return (
		!v || ["false", "0", "no", "off", ""].includes(String(v).toLowerCase())
	);
}

/**
 * Case-insensitive field read.
 *
 * `heatpump_info` already proves the panel does not spell a subsystem object's
 * keys the same way twice — get_home says `isheatpumpPresent`, the write
 * commands echo `isHPMPresent` — and `swc_info` has never been captured from a
 * panel that actually pairs a cell, so which casing arrives is not knowable
 * from here. Every read of that object goes through this rather than guessing.
 */
function field(obj: Raw, name: string): unknown {
	if (name in obj) return obj[name];
	const wanted = name.toLowerCase();
	for (const key of Object.keys(obj)) {
		if (key.toLowerCase() === wanted) return obj[key];
	}
	return undefined;
}

/**
 * A salt cell, but only when the panel says one is paired.
 *
 * `swc_info` is on the home screen whether or not a cell exists — a panel
 * without one answers `{"isswcPresent": false}` — so the object being there
 * proves nothing, and only an affirmative flag counts. Returning null for
 * anything else is the whole gate: every chlorinator control downstream hangs
 * off this, and a panel with no cell must come out of normalize() looking
 * exactly as it did before any of this existed.
 *
 * The two fallbacks are deliberately narrow. A `swc_info` with no presence
 * flag at all is read on its contents, since an object carrying a live output
 * came from somewhere; and the flat `swc_set_point` is consulted only when
 * `swc_info` is missing entirely, because a panel that answered false has
 * already given its answer and must not be argued with.
 */
function buildSaltCell(merged: Raw): SaltCell | null {
	const raw = merged.swc_info;
	const info =
		raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : null;

	const flag = info ? field(info, "isswcPresent") : undefined;
	const present =
		flag !== undefined
			? !isNo(flag)
			: info
				? num(field(info, "swcPoolValue")) !== null ||
					Boolean(str(field(info, "swcPoolStatus")))
				: num(merged.swc_set_point) !== null;
	if (!present) return null;

	const src = info ?? {};
	const status = (name: string) =>
		str(field(src, name))?.trim().toLowerCase() ?? "";

	return {
		poolOutput: num(field(src, "swcPoolValue")),
		spaOutput: num(field(src, "swcSpaValue")),
		poolStatus: status("swcPoolStatus"),
		spaStatus: status("swcSpaStatus"),
		lowSalt: isOn(merged.swc_low),
		boosting: isOn(merged.swc_boost),
		setPoint: num(merged.swc_set_point),
	};
}

/**
 * The shortest printable run this will call a name.
 *
 * The packet is overwhelmingly readings, and a reading byte that happens to
 * land in the printable range is indistinguishable from a letter by type
 * alone. This pool's own packet carries four of them — 0x50, 0x68, 0x58, 0x59,
 * which decode as P, h, X, Y and are the pool set point, the spa set point,
 * the air and the pool temperature — plus a bare 0x20 0x21 among the header
 * bytes. None survives past two characters, because the readings are 16-bit
 * and the high byte of a temperature is 0x00, which ends a run. Four sits
 * above all of them and below the shortest identity Jandy prints — RS-4, RS-8,
 * iQ20 are the short end of the family — so it separates a name from a
 * coincidence without a floor that could reject a real panel's answer.
 */
const MIN_MODEL_CHARS = 4;

/** NUL: what the decode below puts where printable text stopped. */
const TEXT_BREAK = String.fromCharCode(0);

/**
 * The panel's own model string, read out of the raw RS-485 frame that get_home
 * echoes back in `response` and that nothing else in the app looks at.
 *
 * The frame is the pad's reply verbatim, rendered as `AQU='70','0D 00 ...'`,
 * and its tail is ASCII: this panel spells `B0316823 RS-4 Combo`, a part number
 * and a model. Everything before it is the readings normalize already parses by
 * name, so the text is the only part worth taking — and it is taken by looking
 * for text rather than by offset, since no other panel's frame has been seen
 * and the one thing that cannot vary is that a name is printable and a reading
 * mostly is not. Nothing here assumes a length, a position, or the word RS.
 *
 * Read off `home` rather than the merged screens on purpose: `response` is a
 * generic field name that any command's reply could carry, and the devices
 * screen merging over the home screen would silently swap one frame for
 * another. The model belongs to the home frame or to nothing.
 */
function buildModel(response: unknown): string | null {
	const packet = str(response);
	if (!packet) return null;

	// Hex pairs, run by run. A run breaks wherever the string stops being bytes,
	// which is what keeps the `'70'` command number in the prefix from joining
	// the frame that follows it. Whitespace between pairs is optional so that a
	// panel writing the frame unspaced still decodes.
	let best = "";
	for (const [run] of packet.matchAll(/[0-9a-f]{2}(?:\s*[0-9a-f]{2})*/gi)) {
		let text = "";
		for (const pair of run.match(/[0-9a-f]{2}/gi) ?? []) {
			const code = Number.parseInt(pair, 16);
			// Anything outside printable ASCII ends the text rather than joining it:
			// the NUL padding the name is buried in, and the readings either side.
			// The break has to be a NUL and not a space: the name has a space in
			// it, and splitting on that would cut `RS-4 Combo` in half.
			text +=
				code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : TEXT_BREAK;
		}
		for (const candidate of text.split(TEXT_BREAK)) {
			// Ties go to the later run: where a frame carries two names, the
			// identity is the tail.
			const trimmed = candidate.trim();
			if (trimmed.length >= best.length) best = trimmed;
		}
	}

	if (best.length < MIN_MODEL_CHARS) return null;
	// Digits and punctuation alone are a reading that got through on length, not
	// a name. Every identity a panel prints has letters in it.
	return /[a-z]/i.test(best) ? best : null;
}

/**
 * The screen is padded to the panel's maximum, so most entries are empty
 * slots: `status` 0 means never configured, and those are dropped rather than
 * shown as macros with nothing behind them. `state` is which one is running.
 */
function buildMacros(onetouch: unknown): OneTouchMacro[] {
	if (!Array.isArray(onetouch)) return [];
	const flat: Raw = {};
	for (const row of onetouch) {
		if (row && typeof row === "object") Object.assign(flat, row);
	}

	const out: OneTouchMacro[] = [];
	for (const [name, value] of Object.entries(flat)) {
		if (!name.startsWith("onetouch_") || !Array.isArray(value)) continue;
		const attrs: Raw = {};
		for (const part of value) {
			if (part && typeof part === "object") Object.assign(attrs, part);
		}
		if (str(attrs.status) === "0") continue;
		out.push({
			name,
			label: str(attrs.label) || name,
			on: isOn(attrs.state),
		});
	}
	return out;
}

export function normalize(
	serial: string,
	home: Raw,
	devices: Raw,
	icl?: unknown,
	onetouch?: unknown,
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
		model: buildModel(home.response),
		fetchedAt: Date.now(),
		devices: out,
		icl: buildZones(icl),
		heatPump: buildHeatPump(merged.heatpump_info),
		saltCell: buildSaltCell(merged),
		macros: buildMacros(onetouch),
		raw: merged,
	};
}

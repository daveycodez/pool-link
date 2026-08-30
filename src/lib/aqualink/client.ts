/**
 * Port of `iaqualink/client.py` — the browser-direct Aqualink client.
 *
 * Login is flat Cognito (our live response), device list comes from prm
 * locations (CORS-open), and all telemetry/control rides p-api session.json
 * (CORS-open). Exposes both the OO `AqualinkClient` and app-facing helpers.
 */
import {
	API_KEY,
	accountUrl,
	CMD_ENABLE_DISABLE_HPM,
	CMD_GET_DEVICES,
	CMD_GET_HOME,
	CMD_GET_MASTER_DEVICE_LIST,
	CMD_GET_ONETOUCH,
	CMD_GET_VSP_APPMODELSERIALS,
	CMD_GET_VSP_NAMES,
	CMD_GET_VSP_SPEED,
	CMD_ICL_ONOFF,
	CMD_ICL_SET_COLOR,
	CMD_ICL_SET_CUSTOM_COLOR,
	CMD_SET_ONETOUCH,
	CMD_SET_VSP_SPEED,
	CMD_SETPOINT_HPM_TEMP,
	CMD_SWITCH_HPM_MODE,
	LOGIN_URL,
	PAPI_SESSION_URL,
	PRM,
	REFRESH_URL,
	USER_ID_URL,
} from "./constants";
import { decodeJwtClaims, jwtExpiry } from "./crypto";
import {
	clearSession,
	loadSession,
	type Session,
	saveSession,
} from "./session";
import { type AqualinkClientLike, IaquaSystem, mergeScreen } from "./system";
import {
	AqualinkError,
	type Payload,
	type Raw,
	type SystemSummary,
} from "./types";

/** Failed responses often carry a JSON explanation; keep it for diagnostics. */
async function readBody(res: Response): Promise<unknown> {
	const text = await res.text().catch(() => "");
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function pick(...vals: unknown[]): string {
	for (const v of vals) {
		if (typeof v === "string" && v !== "") return v;
		if (typeof v === "number") return String(v);
	}
	return "";
}

function idTokenOf(data: Raw): string {
	return pick(
		data.IdToken,
		(data.userPoolOAuth as Raw)?.IdToken,
		data.access_token,
	);
}

export class AqualinkClient implements AqualinkClientLike {
	private session: Session | null = null;
	private refreshing: Promise<Session> | null = null;

	/** Password is used once, here, then forgotten. */
	async login(email: string, secret: string): Promise<Session> {
		const res = await fetch(LOGIN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ api_key: API_KEY, email, password: secret }),
		});
		if (!res.ok)
			throw new AqualinkError(
				`Login failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		const data = (await res.json()) as Raw;
		const idToken = idTokenOf(data);
		if (!idToken) throw new AqualinkError("Login returned no ID token", 401);

		const claims = decodeJwtClaims(idToken);
		const s: Session = {
			email,
			idToken,
			refreshToken: pick(
				data.RefreshToken,
				(data.userPoolOAuth as Raw)?.RefreshToken,
			),
			clientId: pick(data.session_id, claims["custom:per_session_id"]),
			userId: pick(data.userId, data.user_id, claims["custom:rubie_user_id"]),
			appClientId: pick((data.cognitoPool as Raw)?.appClientId, claims.aud),
			country: (
				pick(data.country, claims["custom:country"]) || "us"
			).toLowerCase(),
		};
		s.userId = (await this.resolveUserId(s)) || s.userId;
		this.session = s;
		await saveSession(s);
		return s;
	}

	private async resolveUserId(s: Session): Promise<string> {
		try {
			const res = await fetch(USER_ID_URL, {
				headers: {
					Authorization: `Bearer ${s.idToken}`,
					Accept: "application/json",
				},
			});
			if (!res.ok) return "";
			const data = (await res.json().catch(() => null)) as Raw | string | null;
			if (typeof data === "string") return data.trim();
			if (!data) return "";
			return pick(
				data.session_user_id,
				data.userId,
				(data.data as Raw)?.session_user_id,
			);
		} catch {
			return "";
		}
	}

	private async refresh(existing: Session): Promise<Session> {
		const res = await fetch(REFRESH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: existing.email,
				refresh_token: existing.refreshToken,
			}),
		});
		if (!res.ok)
			throw new AqualinkError(
				`Refresh failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		const data = (await res.json()) as Raw;
		const merged: Session = {
			...existing,
			idToken: idTokenOf(data) || existing.idToken,
			refreshToken:
				pick(data.RefreshToken, (data.userPoolOAuth as Raw)?.RefreshToken) ||
				existing.refreshToken,
		};
		this.session = merged;
		await saveSession(merged);
		return merged;
	}

	private async restore(): Promise<Session | null> {
		if (this.session) return this.session;
		this.session = await loadSession();
		return this.session;
	}

	private async currentSession(): Promise<Session> {
		const s = await this.restore();
		if (!s?.idToken) throw new AqualinkError("Not authenticated", 401);
		const exp = jwtExpiry(s.idToken);
		if (exp && exp * 1000 - Date.now() < 60_000) {
			this.refreshing ??= this.refresh(s).finally(() => {
				this.refreshing = null;
			});
			return this.refreshing;
		}
		return s;
	}

	/** p-api session request (telemetry + control). */
	async sessionRequest(
		serial: string,
		command: string,
		params: Payload = {},
	): Promise<Raw> {
		const run = async () => {
			const s = await this.currentSession();
			const qs = new URLSearchParams({
				actionID: "command",
				command,
				serial,
				sessionID: s.clientId,
			});
			for (const [k, v] of Object.entries(params)) qs.set(k, v);
			return fetch(`${PAPI_SESSION_URL}?${qs}`, {
				headers: {
					Authorization: `Bearer ${s.idToken}`,
					// The p-api CORS allow-list is "X-Api-Key" (not "api_key"),
					// so this exact header name is required for the preflight.
					"X-Api-Key": API_KEY,
					Accept: "application/json",
				},
			});
		};
		let res = await run();
		if (res.status === 401) {
			const s = await this.restore();
			if (s?.refreshToken) {
				await this.refresh(s);
				res = await run();
			} else {
				this.session = null;
				await clearSession();
				throw new AqualinkError("Session expired — sign in again", 401);
			}
		}
		if (!res.ok)
			throw new AqualinkError(
				`Request failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		return (await res.json()) as Raw;
	}

	/** prm locations → device list (the serial source for p-api). */
	async getSystems(): Promise<SystemSummary[]> {
		const s = await this.currentSession();
		const res = await fetch(`${PRM}/users/${s.userId}/locations`, {
			headers: {
				Authorization: `Bearer ${s.idToken}`,
				Accept: "application/json",
			},
		});
		if (res.status === 401) {
			const st = await this.restore();
			if (st?.refreshToken) {
				await this.refresh(st);
				return this.getSystems();
			}
			this.session = null;
			await clearSession();
			throw new AqualinkError("Session expired — sign in again", 401);
		}
		if (!res.ok)
			throw new AqualinkError(
				`Locations failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		const data = (await res.json()) as Raw;
		const arr = Array.isArray(data) ? data : pickList(data);
		return arr.map((raw) => {
			const r = raw as Raw;
			return {
				serial: pick(r.serial_number, r.serial, r.deviceId, r.device_id, r.id),
				name: pick(r.Name, r.name, r.deviceName, r.label) || "Pool",
				status: pick(r.status, r.connectionStatus) || "unknown",
				isVSP: r.isVSP === "true" || r.isVSP === true,
				type: pick(r.device_type, r.type, r.model) || "iaqualink",
			};
		});
	}

	/** Build an iaqua system bound to this client (for OO use). */
	system(serial: string, name = "Pool"): IaquaSystem {
		return new IaquaSystem(this, { serial, name });
	}

	async account(): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(accountUrl(s.userId).replace(PRM, ""));
	}

	/** Generic authenticated prm GET (diagnostics / account). */
	async prm(url: string, init: RequestInit = {}): Promise<Raw> {
		const s = await this.currentSession();
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${s.idToken}`);
		headers.set("Accept", "application/json");
		const res = await fetch(url.startsWith("http") ? url : `${PRM}${url}`, {
			...init,
			headers,
		});
		if (!res.ok)
			throw new AqualinkError(
				`Request failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		return (await res.json()) as Raw;
	}

	/**
	 * Online/offline for one system. prm's locations payload carries only a
	 * `statusLink` token, not the status itself, so this is a second call.
	 */
	async getDeviceStatus(serial: string): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(`/device/${serial}/status`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: s.userId }),
		});
	}

	/** Attach a system to this account by serial. */
	async addDevice(serial: string, name: string): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(`/device/${serial}/add_device`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, userId: s.userId }),
		});
	}

	/**
	 * Rename a system. Not part of the upstream `iaqualink` package — that
	 * library only ever reads from prm. Serial goes in the path, prm user id
	 * in the body.
	 */
	async setDeviceName(serial: string, name: string): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(`/device/${serial}/name`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, userId: s.userId }),
		});
	}

	async logout(): Promise<void> {
		this.session = null;
		await clearSession();
	}

	sessionMeta(): { userId: string; country: string } {
		return {
			userId: this.session?.userId ?? "",
			country: this.session?.country ?? "",
		};
	}
}

// ---- App-facing convenience helpers (singleton) -----------------------------

const client = new AqualinkClient();

export function login(email: string, password: string) {
	return client.login(email, password);
}

export function logout(): Promise<void> {
	return client.logout();
}

export function listSystems(): Promise<SystemSummary[]> {
	return client.getSystems();
}

export function sessionMeta() {
	return client.sessionMeta();
}

export async function snapshot(
	serial: string,
): Promise<{ home: Raw; devices: Raw; icl: unknown; onetouch: unknown }> {
	const [homeResp, devicesResp, onetouchResp] = await Promise.all([
		client.sessionRequest(serial, "get_home"),
		client.sessionRequest(serial, "get_devices"),
		// The home response says whether macros exist, but waiting to find out
		// would cost a second round trip. Asking in parallel and tolerating the
		// refusal is cheaper, and a panel without them answers harmlessly.
		getOnetouch(serial).catch(() => undefined),
	]);
	return {
		home: mergeScreen(homeResp.home_screen ?? homeResp),
		devices: mergeScreen(devicesResp.devices_screen ?? devicesResp),
		// Colour-light zones ride alongside devices_screen rather than inside
		// it, so mergeScreen never sees them. No extra request for these.
		icl: devicesResp.icl_info_list,
		onetouch: onetouchResp?.onetouch_screen,
	};
}

export async function toggleDevice(
	serial: string,
	name: string,
	kind: string,
	on: boolean,
	subtype = "",
): Promise<Raw> {
	if (kind === "light") {
		return client.sessionRequest(serial, "set_light", {
			aux: name.replace(/^aux_/i, ""),
			light: on ? "1" : "0",
			subtype,
		});
	}
	return client.sessionRequest(serial, `set_${name}`);
}

/** Set a light's effect (color) by id, e.g. Jandy WaterColors id 1..14. */
export function setLightColor(
	serial: string,
	auxName: string,
	subtype: string,
	effectId: number,
): Promise<Raw> {
	return client.sessionRequest(serial, "set_light", {
		aux: auxName.replace(/^aux_/i, ""),
		light: String(effectId),
		subtype,
	});
}

export async function setTemps(
	serial: string,
	spa: string,
	pool: string,
): Promise<Raw> {
	return client.sessionRequest(serial, "set_temps", {
		temp1: spa,
		temp2: pool,
	});
}

/** Attach a system to this account by serial. */
export function addDevice(serial: string, name: string): Promise<Raw> {
	return client.addDevice(serial, name);
}

/** Online/offline for one system. */
export function getDeviceStatus(serial: string): Promise<Raw> {
	return client.getDeviceStatus(serial);
}

/** Rename the system as it appears in the iAqualink account. */
export function setDeviceName(serial: string, name: string): Promise<Raw> {
	return client.setDeviceName(serial, name);
}

export function account(): Promise<Raw> {
	return client.account();
}

/** Authenticated prm request (diagnostics). */
export function api<T = Raw>(url: string, init: RequestInit = {}): Promise<T> {
	return client.prm(url, init) as Promise<T>;
}

// ---- Full p-api surface -----------------------------------------------------
// Every command the upstream `iaqualink` package sends. Nothing here is wired
// into the dashboard yet — these exist so /diagnostics can probe the real API
// and so the VSP layer has somewhere to land.

/** Raw command escape hatch: any command string, any params. */
export function command(
	serial: string,
	cmd: string,
	params: Payload = {},
): Promise<Raw> {
	return client.sessionRequest(serial, cmd, params);
}

// -- Screen reads --

/**
 * Home screen. Upstream sends `attached_test` + `country`; `snapshot()` omits
 * them and still works, so this is the higher-fidelity read of the two.
 */
export function getHome(serial: string): Promise<Raw> {
	const { country } = client.sessionMeta();
	return client.sessionRequest(serial, CMD_GET_HOME, {
		attached_test: "true",
		country,
	});
}

export function getDevices(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_DEVICES);
}

export function getOnetouch(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_ONETOUCH);
}

// -- Variable speed pumps --

/** pumpId -> pumpName for every VSP the panel knows about. */
export function getVspNames(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_VSP_NAMES);
}

/** Current speeds plus the speed<->aux associations, per pump slot. */
export function getVspSpeeds(serial: string, slotId = 1): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_VSP_SPEED, {
		slot_id: String(slotId),
	});
}

export function getVspAppModelSerials(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_VSP_APPMODELSERIALS);
}

/**
 * Device list carrying the per-device `isVSP` flag that identifies pump slots.
 * `listType` is mandatory (0 | 1 | 2) — upstream iaqualink-py omits it and the
 * server answers 400, so this is a fix rather than a port of their call.
 */
export function getMasterDeviceList(
	serial: string,
	listType: "0" | "1" | "2" = "0",
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_MASTER_DEVICE_LIST, {
		listType,
	});
}

/** Run a pump at one of its configured speeds, addressed by id. */
export function setVspSpeed(
	serial: string,
	speedId: number,
	slotId = 1,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_VSP_SPEED, {
		slot_id: String(slotId),
		speed_id: String(speedId),
		on_off_action: "on",
	});
}

/** Stop a pump. `speed_id` is required but ignored when the action is "off". */
export function stopVspPump(serial: string, slotId = 1): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_VSP_SPEED, {
		slot_id: String(slotId),
		speed_id: "1",
		on_off_action: "off",
	});
}

/** One variable-speed pump the panel has an actual pump wired to. */
export interface VspPump {
	/** Pump slot. Doubles as `slot_id` on every VSP command. */
	pumpId: number;
	name: string;
	/** What the panel uses it for, e.g. "Filtration" or "Aux Pump". */
	app: string;
	min: number;
	max: number;
	speeds: VspSpeed[];
	/** Aux relay numbers this pump drives, from the panel's own assignments. */
	auxes: number[];
}

export interface VspSpeed {
	id: number;
	name: string;
	rpm: number;
	/** The speed the pump is set to right now. */
	active: boolean;
}

const rows = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/**
 * The panel reports twenty pump slots whether or not anything is plugged in.
 * An empty slot answers with `appId: 0` and no serial, and its speed table is
 * the factory default — so `appId` is what separates a real pump from a stub,
 * not the name, which is "PumpN" for both configured and unconfigured slots.
 */
export async function listVspPumps(serial: string): Promise<VspPump[]> {
	const [names, models] = await Promise.all([
		getVspNames(serial),
		getVspAppModelSerials(serial),
	]);

	const named = new Map<number, string>();
	for (const n of rows(names.vsp_names)) {
		named.set(Number(n.pumpId), String(n.pumpName ?? ""));
	}

	const installed = rows(models.vsp_app_model_serials).filter(
		(m) => Number(m.appId) !== 0,
	);

	return Promise.all(
		installed.map(async (m) => {
			const pumpId = Number(m.pumpId);
			const slot = await getPumpSpeeds(serial, pumpId);
			return {
				pumpId,
				name: named.get(pumpId) || `Pump ${pumpId}`,
				app: String(m.appName ?? ""),
				...slot,
			};
		}),
	);
}

/**
 * A slot always returns eight speeds. The ones the owner never configured keep
 * the panel's placeholder name ("Speed4"), so those are dropped — unless that
 * would empty the list, in which case the raw eight are better than nothing.
 */
async function getPumpSpeeds(serial: string, pumpId: number) {
	const raw = await getVspSpeeds(serial, pumpId);
	const all: VspSpeed[] = rows(raw.vsp_speedInfo).map((s) => ({
		id: Number(s.speedid),
		name: String(s.speedName ?? ""),
		rpm: Number(s.speedvalue),
		active: s.enabled === "true",
	}));
	const named = all.filter((s) => !/^Speed\d+$/.test(s.name));

	// Position n of the assignment list is aux n, holding the speed that aux
	// runs at, or "No". This is what ties a pump to a relay without matching
	// on names, which differ per install.
	const assignments = Array.isArray(raw.aux_speed_assignments)
		? (raw.aux_speed_assignments as unknown[])
		: [];
	const auxes = assignments
		.map((a, i) => (/^\d+$/.test(String(a)) ? i + 1 : 0))
		.filter((n) => n > 0);

	return {
		min: Number(raw.minSpeed),
		max: Number(raw.maxSpeed),
		speeds: named.length > 0 ? named : all,
		auxes,
	};
}

/** The pump driving a device, matched on the aux relay the device sits on. */
export function pumpForDevice(
	pumps: VspPump[] | undefined,
	deviceName: string | undefined,
): VspPump | undefined {
	const aux = /^aux_(\d+)$/.exec(deviceName ?? "");
	if (!aux) return undefined;
	const n = Number(aux[1]);
	return pumps?.find((p) => p.auxes.includes(n));
}

// -- Heat pump module --

export function enableHpm(serial: string, on: boolean): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ENABLE_DISABLE_HPM, {
		on_off_action: on ? "on" : "off",
	});
}

export function switchHpmMode(serial: string, mode: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SWITCH_HPM_MODE, {
		hpm_mode: mode,
	});
}

/** Unlike set_temps, only the changed set point is sent — no seeding. */
export function setHpmSetPoint(serial: string, temps: Payload): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SETPOINT_HPM_TEMP, temps);
}

// -- ICL light zones --

export function iclZoneOnOff(
	serial: string,
	zoneId: number,
	on: boolean,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_ONOFF, {
		zone_id: String(zoneId),
		on_off_action: on ? "on" : "off",
	});
}

export function iclSetColor(
	serial: string,
	zoneId: number,
	colorId: number,
	dimLevel = 100,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_SET_COLOR, {
		zone_id: String(zoneId),
		color_id: String(colorId),
		dim_level: String(dimLevel),
	});
}

/** Brightness rides the same command as colour — there is no set_iclzone_dim. */
export function iclSetBrightness(
	serial: string,
	zoneId: number,
	dimLevel: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_SET_COLOR, {
		zone_id: String(zoneId),
		dim_level: String(dimLevel),
	});
}

export function iclSetCustomColor(
	serial: string,
	zoneId: number,
	red: number,
	green: number,
	blue: number,
	white = 0,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_SET_CUSTOM_COLOR, {
		zone_id: String(zoneId),
		red_val: String(red),
		green_val: String(green),
		blue_val: String(blue),
		white_val: String(white),
	});
}

// -- Bare toggles --

/**
 * Toggle a named system switch: set_pool_pump, set_spa_pump, set_pool_heater,
 * set_spa_heater, set_solar_heater. These carry no state param — they flip.
 */
export function setSwitch(serial: string, cmd: string): Promise<Raw> {
	return client.sessionRequest(serial, cmd);
}

/** Fire a OneTouch macro. The name is appended to the command, not passed. */
export function setOnetouch(serial: string, name: string): Promise<Raw> {
	const id = name.replace(/^onetouch_/, "");
	return client.sessionRequest(serial, `${CMD_SET_ONETOUCH}_${id}`);
}

function pickList(data: Raw): unknown[] {
	for (const k of ["locations", "devices", "data", "items", "results"]) {
		const v = data[k];
		if (Array.isArray(v)) return v;
		const nested =
			v && typeof v === "object"
				? ((v as Raw).devices ?? (v as Raw).locations)
				: undefined;
		if (Array.isArray(nested)) return nested;
	}
	return [];
}

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
			throw new AqualinkError(`Login failed (${res.status})`, res.status);
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
			throw new AqualinkError(`Refresh failed (${res.status})`, res.status);
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
			throw new AqualinkError(`Request failed (${res.status})`, res.status);
		return (await res.json()) as Raw;
	}

	/** prm locations → device list (the serial source for p-api). */
	async getSystems(): Promise<SystemSummary[]> {
		const s = await this.currentSession();
		const qs = new URLSearchParams();
		qs.set("userId", s.userId);
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
			throw new AqualinkError(`Locations failed (${res.status})`, res.status);
		const data = (await res.json()) as Raw;
		const arr = Array.isArray(data) ? data : pickList(data);
		return arr.map((raw) => {
			const r = raw as Raw;
			return {
				serial: pick(r.serial_number, r.serial, r.deviceId, r.device_id, r.id),
				name: pick(r.Name, r.name, r.deviceName, r.label) || "Pool",
				status: pick(r.status, r.connectionStatus) || "unknown",
				isVSP: r.isVSP === "true" || r.isVSP === true,
				type: pick(r.type, r.model) || "iaqualink",
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
			throw new AqualinkError(`Request failed (${res.status})`, res.status);
		return (await res.json()) as Raw;
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
): Promise<{ home: Raw; devices: Raw }> {
	const [homeResp, devicesResp] = await Promise.all([
		client.sessionRequest(serial, "get_home"),
		client.sessionRequest(serial, "get_devices"),
	]);
	return {
		home: mergeScreen(homeResp.home_screen ?? homeResp),
		devices: mergeScreen(devicesResp.devices_screen ?? devicesResp),
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

export function account(): Promise<Raw> {
	return client.account();
}

/** Authenticated prm request (diagnostics). */
export function api<T = Raw>(url: string, init: RequestInit = {}): Promise<T> {
	return client.prm(url, init) as Promise<T>;
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

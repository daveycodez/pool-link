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
	CMD_ASSIGN_VSP_SERIAL,
	CMD_CONTROL_SWC_BOOST,
	CMD_DO_1POINT_PH_CALIBRATION,
	CMD_DO_2POINT_PH_CALIBRATION,
	CMD_DO_ORP_CALIBRATION,
	CMD_DO_SCHEDULE_OPERATION,
	CMD_ENABLE_DISABLE_HPM,
	CMD_ENABLE_PUMP_SPEED_VALUE,
	CMD_GET_DEVICES,
	CMD_GET_HOME,
	CMD_GET_MASTER_DEVICE_LIST,
	CMD_GET_ONETOUCH,
	CMD_GET_PHORP_CALIBSTATUS,
	CMD_GET_PHORP_LASTCALIBINFO,
	CMD_GET_PHORP_VALUES,
	CMD_GET_SCHEDULE_LIST,
	CMD_GET_SWC_CONFIG,
	CMD_GET_UNASSIGNED_SERIALS,
	CMD_GET_VSP_APPMODELSERIALS,
	CMD_GET_VSP_DEFINITION,
	CMD_GET_VSP_NAMES,
	CMD_GET_VSP_SPEED,
	CMD_ICL_GET_INFO,
	CMD_ICL_MOVE_LIGHTS,
	CMD_ICL_ONOFF,
	CMD_ICL_SET_COLOR,
	CMD_ICL_SET_CUSTOM_COLOR,
	CMD_ICL_SET_DIM,
	CMD_ICL_SET_NAME,
	CMD_ICL_ZONING_MODE,
	CMD_SET_AUX_SPEED,
	CMD_SET_LIGHT,
	CMD_SET_ONETOUCH,
	CMD_SET_SPEED_NAME,
	CMD_SET_SPEEDNAME_VALUE,
	CMD_SET_SWC_CONFIG,
	CMD_SET_VSP_DEFINITION,
	CMD_SET_VSP_NAME,
	CMD_SET_VSP_SPEED,
	CMD_SETPOINT_HPM_TEMP,
	CMD_SWITCH_HPM_MODE,
	CMD_UNASSIGN_VSP_SERIAL,
	LOGIN_URL,
	PAPI_SESSION_URL,
	PRM,
	REFRESH_URL,
	USER_ID_URL,
} from "./constants";
import { decodeJwtClaims, jwtExpiry } from "./crypto";
import { ICL_ZONE_NAME_MAX } from "./enums";
import {
	clearSession,
	loadSession,
	refuseSession,
	type Session,
	sameAccount,
	saveSession,
	sessionRefused,
	storedSession,
} from "./session";
import { type AqualinkClientLike, mergeScreen } from "./system";
import {
	AqualinkError,
	type Payload,
	type Raw,
	type SystemSummary,
} from "./types";

/**
 * How long a request may run before it is abandoned.
 *
 * Nothing here had a deadline, and `fetch` has none of its own — a request the
 * pool never answers hangs until the tab is closed, which leaves the query that
 * made it permanently fetching with nothing in the app able to recover it. That
 * is not hypothetical on this API: upstream iaqualink-py records `get_icl_info`
 * timing out on some hardware, and this client now sends about a dozen commands
 * nobody has ever exercised.
 *
 * The two numbers are different because the two paths are. A session request is
 * a command relayed from a cloud endpoint down to an RS-485 pad that serialises
 * everything it is asked and answers at its own pace, so it is genuinely slow in
 * a way no amount of network health fixes. The two independent clients that poll
 * this same API in production bound it far tighter — iaqualink-py at a flat 10s,
 * Goose66's ISY driver at 6.05s for a GET — which is the evidence that a working
 * pad answers well inside ten seconds. Twenty is double that ceiling, so every
 * request those two would have completed completes here with room to spare, and
 * it is still under the thirty seconds at which the header chip stops calling
 * the data live: a pad that has gone quiet gets reported as stale and then as an
 * error, rather than as a spinner that never resolves. With `panelOptions`
 * retrying twice, the worst case a screen can sit in is about a minute, which is
 * bounded and eventually says something.
 *
 * Everything that is not a pad command gets upstream's own figure, because that
 * is the case upstream measured: login and refresh are flat Cognito, and the prm
 * calls — the location list, a device's status, a rename — are an ordinary web
 * API. None of them has an RS-485 leg, so there is nothing for them to be slow
 * about beyond the network itself. Refresh matters most of the three, because
 * `currentSession` puts it in front of every other request: a long wait there
 * stalls the whole app rather than one screen, and ten seconds is already well
 * past a healthy round trip to a cloud endpoint.
 */
const PANEL_TIMEOUT_MS = 20_000;
const CLOUD_TIMEOUT_MS = 10_000;

/**
 * How much life an idToken must have left to be worth sending.
 *
 * A minute, which is generous against a token that lives an hour, and the
 * generosity is the point: a request that sets out with a valid token and
 * arrives with an expired one comes back 401, and the app's answer to a 401 is
 * to refresh and retry — so the cost of being early is nothing, and the cost of
 * being late is a wasted round trip to a pad that is slow to begin with. It also
 * has to cover a clock: the expiry is read out of the token's own claims and
 * compared against this device's idea of the time, which on a phone that has
 * been asleep is not always the pool's.
 *
 * Shared with `adopt`, deliberately. A session picked up from another tab has to
 * be judged fresh by exactly the same bar as the one this tab is holding, or the
 * two would disagree about whether the same token is worth using.
 */
const TOKEN_MARGIN_MS = 60_000;

/**
 * An abort, as a failure the rest of the app already knows how to handle.
 *
 * `AqualinkError` with no status is the shape that matters. `panelOptions`
 * refuses to retry a 401 and retries everything else twice, so a timeout must
 * carry no status at all — a timed-out request says nothing whatever about
 * whether the session is still good, and borrowing 401 for it would sign
 * someone out over a slow network. Everything else, a caller's own abort
 * included, passes through untouched: react-query cancels queries with one, and
 * dressing that up as a request failure would report a navigation as an error.
 */
function asFailure(error: unknown, ms: number): unknown {
	return error instanceof Error && error.name === "TimeoutError"
		? new AqualinkError(`Request timed out after ${ms / 1000}s`, undefined, {
				error: "The pool did not answer in time",
			})
		: error;
}

/**
 * `fetch` with a deadline on it.
 *
 * The signal covers the body stream as well as the response, which is why
 * `jsonBody` exists rather than the call sites reading `res.json()` themselves:
 * an abort landing between the headers and the last byte has to arrive as the
 * same failure as one landing before either.
 *
 * A caller's own signal is kept rather than replaced. Nothing passes one today,
 * but `api()` takes a whole `RequestInit` from outside this module, and a
 * spread that quietly dropped an abort signal would be a trap set for whoever
 * uses it next.
 */
async function fetchWithin(
	ms: number,
	input: string,
	init: RequestInit = {},
): Promise<Response> {
	const deadline = AbortSignal.timeout(ms);
	const signal = init.signal
		? AbortSignal.any([init.signal, deadline])
		: deadline;
	try {
		return await fetch(input, { ...init, signal });
	} catch (error) {
		throw asFailure(error, ms);
	}
}

/** The JSON body, with an abort mid-stream reported like any other timeout. */
async function jsonBody(res: Response, ms: number): Promise<Raw> {
	try {
		return (await res.json()) as Raw;
	} catch (error) {
		throw asFailure(error, ms);
	}
}

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
		const res = await fetchWithin(CLOUD_TIMEOUT_MS, LOGIN_URL, {
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
		const data = await jsonBody(res, CLOUD_TIMEOUT_MS);
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
			// `perl` and `ruby`, not `per` and `rubie`. Both spellings here were
			// wrong, which went unnoticed because each is a fallback behind a
			// field the login reply does carry — so they could never fire, and
			// the claim was dead weight rather than the safety net it reads as.
			// Checked against a real idToken from this pool, whose custom claims
			// are `custom:perl_session_id` and `custom:ruby_user_id`.
			clientId: pick(data.session_id, claims["custom:perl_session_id"]),
			userId: pick(data.userId, data.user_id, claims["custom:ruby_user_id"]),
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
			const res = await fetchWithin(CLOUD_TIMEOUT_MS, USER_ID_URL, {
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

	/**
	 * Mint a fresh idToken from the refresh token.
	 *
	 * `adopted` says this call is already the retry, and it is the whole loop
	 * guard: the recovery below runs only on the first attempt, so a rejection of
	 * an adopted token ends in the sign-out rather than in another lookup. It is
	 * never passed by anything outside this method.
	 */
	private async refresh(existing: Session, adopted = false): Promise<Session> {
		const res = await fetchWithin(CLOUD_TIMEOUT_MS, REFRESH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: existing.email,
				refresh_token: existing.refreshToken,
			}),
		});
		if (!res.ok) {
			const body = await readBody(res);
			// A rejected refresh token cannot be retried into working, so the
			// session is over and has to go — otherwise it stays in storage, the
			// app still believes it is signed in, and every request fails quietly
			// forever. A 5xx or a network fault is not that, and must not sign
			// anyone out. Rejections are rethrown as 401 whatever the pool
			// answered, so there is one signal for "sign in again".
			if ([400, 401, 403].includes(res.status)) {
				// Except that a rejection here does not only mean the session died.
				// This pool rotates refresh tokens: every successful refresh mints a
				// new one and kills the old. Two tabs on one account each start from
				// the same copy, and the moment either refreshes, the other is
				// holding a token the pool has already retired — so the next time
				// that tab wakes it refreshes, is rejected, and signs itself out of
				// an account that is perfectly alive. That is the failure the owner
				// has actually hit.
				//
				// The recovery is to look where the other tab wrote. `loadSession`
				// cannot help: it reads this tab's own query cache, which the
				// persister fills once at boot and never again, so it would hand back
				// the very token that was just refused. `storedSession` reads the
				// IndexedDB blob every tab writes through, which is the one thing the
				// two tabs genuinely share, and `saveSession` flushes it
				// synchronously for exactly this reason. A token there that differs
				// from the one just rejected is the other tab's newer copy, and it is
				// worth one more attempt.
				//
				// What this cannot fix is the same account on two devices. Their
				// storage is not shared by any mechanism a browser offers, so a phone
				// and a laptop rotating against each other will still sign each other
				// out, and nothing on this side of the wire can change that — it
				// wants either a longer-lived token or a pool that does not rotate.
				// Within one browser, this is the whole of the problem.
				//
				// And only when it is the same account's. Nothing in the blob says
				// whose session it holds, so on a browser two people share the newer
				// token is as likely to be the person who signed in after — see
				// `sameAccount`, which is where that goes wrong and why.
				const newer = adopted ? null : await storedSession();
				if (
					newer &&
					newer.refreshToken !== existing.refreshToken &&
					sameAccount(newer, existing)
				)
					return this.adopt(newer);
				// And when that lookup finds nothing newer, the session is refused
				// rather than deleted. Deleting it is not a local act: the session
				// lives in the persisted cache, so clearing it wrote null straight
				// through to the blob every tab shares and every future boot reads.
				// One refusal ended the account permanently, and silently, because a
				// 401 is a signal this app expects and does not surface.
				//
				// The case just above is the only one that can be recovered from
				// here. The ones that cannot are why this line changed: a rotation
				// lost because a reload landed between the pool's answer and the
				// write that stores it, the other tab's token reaching storage a
				// moment after `storedSession` read it, an upstream 400 that was
				// never about the token at all. From here none of those can be told
				// apart from a session that has genuinely ended, and only the last of
				// the four deserves to take the stored token down with it.
				//
				// So this tab signs out, storage keeps what it holds, and the token
				// that was refused is named — `refuseSession` puts the stored one
				// back to the pool a few seconds from now, and it has to be able to
				// tell "the same token again" from "the token another tab rotated to
				// while we were failing".
				this.session = null;
				refuseSession(existing);
				throw new AqualinkError("Session expired — sign in again", 401, body);
			}
			throw new AqualinkError(
				`Refresh failed (${res.status})`,
				res.status,
				body,
			);
		}
		const data = await jsonBody(res, CLOUD_TIMEOUT_MS);
		const idToken = idTokenOf(data) || existing.idToken;
		const claims = decodeJwtClaims(idToken);
		const merged: Session = {
			...existing,
			idToken,
			refreshToken:
				pick(data.RefreshToken, (data.userPoolOAuth as Raw)?.RefreshToken) ||
				existing.refreshToken,
			/**
			 * Taken from the token just issued rather than carried over.
			 *
			 * `clientId` is the `sessionID` on every p-api command, and the pool
			 * calls it a per-session id — it arrives as `custom:perl_session_id`
			 * on the idToken, which is a claim of the token and not of the
			 * account. Spreading the old session kept the one minted at login for
			 * as long as the tab lived, so if the pool issues a new id with each
			 * refresh, every request after the first refresh carried an id the
			 * pool had retired. That is a 401 on a token that has not expired,
			 * arriving about an hour after signing in, which is a thing this app
			 * has been seen to do and could not otherwise explain.
			 *
			 * Falls back to what was already held, so a reply that names no id
			 * changes nothing — and if the pool does not rotate it, the claim is
			 * the same string and this is a no-op.
			 */
			clientId:
				pick(data.session_id, claims["custom:perl_session_id"]) ||
				existing.clientId,
		};
		this.session = merged;
		await saveSession(merged);
		return merged;
	}

	/**
	 * Take on a session another tab stored, in place of the one just refused.
	 *
	 * Refreshing it again would be the obvious move and it is the wrong one: it
	 * would rotate the token the other tab is holding, retiring that tab's copy
	 * and handing the problem straight back. So the stored idToken is used as it
	 * stands wherever it still has life in it, and both tabs carry on. Only when
	 * it is itself at the margin is a refresh sent — the rotation then has to
	 * happen anyway, and once round the loop is where this stops.
	 *
	 * Written into this tab's cache either way, so what `useSession` reads and
	 * what the request layer holds are the same session.
	 */
	private async adopt(stored: Session): Promise<Session> {
		this.session = stored;
		const exp = jwtExpiry(stored.idToken);
		if (!exp || exp * 1000 - Date.now() < TOKEN_MARGIN_MS)
			return this.refresh(stored, true);
		await saveSession(stored);
		return stored;
	}

	/**
	 * This tab's session, from memory or from the cache the persister filled.
	 *
	 * Null once the session has been refused, and that guard carries weight now
	 * that a refusal leaves storage intact: without it every query this page has
	 * mounted would read the still-present session back out of the cache and put
	 * the same dead token to the pool again, one refusal apiece. The stored copy
	 * is kept for the next boot to try, not for this tab to keep retrying.
	 */
	private async restore(): Promise<Session | null> {
		if (sessionRefused()) return null;
		if (this.session) return this.session;
		this.session = await loadSession();
		return this.session;
	}

	/**
	 * Refresh, but never more than one at a time.
	 *
	 * The pool rotates refresh tokens: a successful refresh mints a new one and
	 * kills the one it was asked with. So two refreshes racing on the same token
	 * are not merely wasteful, they are destructive — the first wins, and every
	 * other one is refused with the same 400 the pool sends for a session that
	 * genuinely died, which lands on `clearSession()` and signs the account out.
	 *
	 * That race is not exotic; it is what the pool screen does by construction.
	 * It mounts ten authenticated queries at once, so a session the cloud has
	 * dropped comes back as ten simultaneous 401s, each of which used to call
	 * `refresh` directly with its own copy of the same token. Nine of them then
	 * signed the owner out of an account that a moment later held a perfectly
	 * good rotated token — silently, because a 401 is a signal this app expects
	 * and does not surface.
	 *
	 * `storedSession`'s recovery inside `refresh` cannot cover this. It was
	 * written for a second tab and only helps once the winner's newer token has
	 * reached IndexedDB; within one tab the losers read the blob in the same few
	 * hundred milliseconds as the winner writes it, find the token they already
	 * have, and fall through. Not racing in the first place is the fix, and this
	 * is where every caller has to go to get it.
	 */
	private refreshOnce(existing: Session): Promise<Session> {
		this.refreshing ??= this.refresh(existing).finally(() => {
			this.refreshing = null;
		});
		return this.refreshing;
	}

	private async currentSession(): Promise<Session> {
		const s = await this.restore();
		if (!s?.idToken) throw new AqualinkError("Not authenticated", 401);
		const exp = jwtExpiry(s.idToken);
		if (exp && exp * 1000 - Date.now() < TOKEN_MARGIN_MS)
			return this.refreshOnce(s);
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
			return fetchWithin(PANEL_TIMEOUT_MS, `${PAPI_SESSION_URL}?${qs}`, {
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
				await this.refreshOnce(s);
				res = await run();
			} else {
				// Refused, not cleared, for the reason `refresh` sets out at length.
				// This branch has even less to go on than that one: all it knows is
				// that the copy this tab holds carries no refresh token, which says
				// nothing about the copy in storage, and a tab that has been running
				// since before another one signed in is exactly how that happens.
				this.session = null;
				refuseSession();
				throw new AqualinkError("Session expired — sign in again", 401);
			}
		}
		if (!res.ok)
			throw new AqualinkError(
				`Request failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		return jsonBody(res, PANEL_TIMEOUT_MS);
	}

	/** prm locations → device list (the serial source for p-api). */
	async getSystems(): Promise<SystemSummary[]> {
		const s = await this.currentSession();
		const res = await fetchWithin(
			CLOUD_TIMEOUT_MS,
			`${PRM}/users/${s.userId}/locations`,
			{
				headers: {
					Authorization: `Bearer ${s.idToken}`,
					Accept: "application/json",
				},
			},
		);
		if (res.status === 401) {
			const st = await this.restore();
			if (st?.refreshToken) {
				await this.refreshOnce(st);
				return this.getSystems();
			}
			// Refused rather than cleared, as in `sessionRequest` and on the same
			// argument `refresh` makes.
			this.session = null;
			refuseSession();
			throw new AqualinkError("Session expired — sign in again", 401);
		}
		if (!res.ok)
			throw new AqualinkError(
				`Locations failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		const data = await jsonBody(res, CLOUD_TIMEOUT_MS);
		const arr = Array.isArray(data) ? data : pickList(data);
		return arr.map((raw) => {
			const r = raw as Raw;
			return {
				serial: pick(r.serial_number, r.serial, r.deviceId, r.device_id, r.id),
				name: pick(r.Name, r.name, r.deviceName, r.label) || "Pool",
				status: pick(r.status, r.connectionStatus) || "unknown",
				isVSP: r.isVSP === "true" || r.isVSP === true,
				type: pick(r.device_type, r.type, r.model) || "iaqualink",
				webtouchId: pick(r.touchLink) || pick(r.serial_number, r.serial),
			};
		});
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
		const res = await fetchWithin(
			CLOUD_TIMEOUT_MS,
			url.startsWith("http") ? url : `${PRM}${url}`,
			{ ...init, headers },
		);
		if (!res.ok)
			throw new AqualinkError(
				`Request failed (${res.status})`,
				res.status,
				await readBody(res),
			);
		return jsonBody(res, CLOUD_TIMEOUT_MS);
	}

	/**
	 * Online/offline for one system. prm's locations payload carries only a
	 * `statusLink` token, not the status itself, so this is a second call.
	 */
	async getDeviceStatus(serial: string): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(`/device/${encodeURIComponent(serial)}/status`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: s.userId }),
		});
	}

	/**
	 * Attach a system to this account by serial.
	 *
	 * The serial reaches the path rather than a query parameter, so it is encoded
	 * here rather than trusted to arrive clean. The add form strips it to
	 * alphanumerics today and every other caller passes a serial the pool itself
	 * reported — but a path built by interpolation is one edit away from taking
	 * a slash, and the edit that does it will not be in this file.
	 */
	async addDevice(serial: string, name: string): Promise<Raw> {
		const s = await this.currentSession();
		return this.prm(`/device/${encodeURIComponent(serial)}/add_device`, {
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
		return this.prm(`/device/${encodeURIComponent(serial)}/name`, {
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

	/**
	 * The WebTouch remote the official app embeds — the panel's own web UI,
	 * for the things no API covers, schedules first among them. The token
	 * rides the URL, so it is minted fresh here: a stale one greets the user
	 * with a login form instead of their panel.
	 */
	async webtouchUrl(webtouchId: string): Promise<string> {
		const s = await this.currentSession();
		const q = new URLSearchParams({ actionID: webtouchId, idToken: s.idToken });
		return `https://webtouch.iaqualink.net/?${q}`;
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

/** A signed-in WebTouch link for one system; see the class method. */
export function webtouchUrl(webtouchId: string): Promise<string> {
	return client.webtouchUrl(webtouchId);
}

/** Home screen: temperatures, set points and the fixed-key equipment state. */
export async function homeScreen(serial: string): Promise<Raw> {
	const res = await client.sessionRequest(serial, "get_home");
	return mergeScreen(res.home_screen ?? res);
}

/**
 * Devices screen: the aux relays, plus the colour-light zones that ride
 * alongside `devices_screen` rather than inside it, where mergeScreen would
 * never see them.
 */
export async function devicesScreen(
	serial: string,
): Promise<{ devices: Raw; icl: unknown }> {
	const res = await client.sessionRequest(serial, "get_devices");
	return {
		devices: mergeScreen(res.devices_screen ?? res),
		icl: res.icl_info_list,
	};
}

/** OneTouch macros. A panel without them answers harmlessly. */
export async function onetouchScreen(serial: string): Promise<unknown> {
	const res = await getOnetouch(serial).catch(() => undefined);
	// Null, never undefined: a panel with no macros is a valid answer, and
	// react-query reads undefined as "the fetcher returned nothing" and throws.
	return res?.onetouch_screen ?? null;
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

/**
 * Set a dimming relay's brightness.
 *
 * The same `set_light` command a colour light rides, minus the `subtype` — and
 * that omission is the whole difference. A dimming relay has no light family to
 * name, so `light` carries a percentage instead of an effect id, and naming a
 * family would tell the panel to read that percentage as an effect on a fixture
 * that has none.
 *
 * Unverified against this pool, which has no dimming relay wired — the shape is
 * two independent implementations agreeing (iaqualink-py's
 * `IaquaDimmableLight`, Goose66's `setLightBrightness`), not a capture. Both
 * quantise to quarters before sending and neither documents what the panel does
 * with anything else, so callers should step in 25s; 0 is off rather than dim,
 * and opens the relay.
 */
export function setDimmerLevel(
	serial: string,
	auxName: string,
	level: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_LIGHT, {
		aux: auxName.replace(/^aux_/i, ""),
		light: String(Math.round(level)),
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
	/**
	 * Which pump's speeds to list. Mandatory for `listType=2` and meaningless
	 * for the others — the panel rejects the type outright without it, naming
	 * the range it wants in the error, which is how the requirement was found.
	 */
	vspId?: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_MASTER_DEVICE_LIST, {
		listType,
		...(vspId === undefined ? {} : { vspId: String(vspId) }),
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

/** A whole number from a wire field, or null when the field says nothing. */
const int = (v: unknown): number | null => {
	if (v === "" || v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n) : null;
};

/** What a pump slot is configured as, behind the speeds it offers. */
export interface VspDefinition {
	slotId: number;
	appId: number;
	/** What the panel runs the pump for, e.g. "Filtration". */
	appName: string;
	/**
	 * "rpm" or "gpm". Every other speed number this pump reports is counted in
	 * this unit and none of them carry it, so a UI that assumes RPM will label a
	 * flow-rate pump's speeds with a unit they are not in.
	 */
	unit: string;
	min: number | null;
	max: number | null;
	model: string;
	modelTypeId: number | null;
	/** Speeds the panel runs on its own initiative, without being asked. */
	primeSpeed: number | null;
	primeDurationMinutes: number | null;
	freezeProtectSpeed: number | null;
}

/**
 * Read one slot's definition.
 *
 * A body with no `vsp_max_speed` is not a definition — it is a rejection the
 * pool chose to send with a 200, or a slot the panel does not describe — and it
 * is thrown rather than coerced, so the raw payload reaches the caller through
 * the error body instead of arriving as a pump made entirely of nulls. That is
 * the same test `readSwcConfig` applies to its set points, for the same reason.
 *
 * The two field names carrying `vsp_pump_` were read as `vsp_appId` and
 * `vsp_speed_unit` when this was written from the protocol reference alone.
 * A live answer names them `vsp_pump_appId` and `vsp_pump_unit`, so both read
 * undefined: every slot claimed an appId of 0, and — the one that mattered —
 * every pump reported an empty unit, which is the field that exists to stop a
 * flow pump's speeds being labelled RPM.
 */
export async function getVspDefinition(
	serial: string,
	slotId = 1,
): Promise<VspDefinition> {
	const raw = await client.sessionRequest(serial, CMD_GET_VSP_DEFINITION, {
		slot_id: String(slotId),
	});
	const max = int(raw.vsp_max_speed);
	if (max === null)
		throw new AqualinkError("No pump definition reported", undefined, raw);
	return {
		slotId: int(raw.slot_id) ?? slotId,
		appId: int(raw.vsp_pump_appId) ?? 0,
		appName: String(raw.vsp_pump_appName ?? ""),
		unit: String(raw.vsp_pump_unit ?? "").toLowerCase(),
		min: int(raw.vsp_min_speed),
		max,
		model: String(raw.vsp_model_type ?? ""),
		modelTypeId: int(raw.vsp_model_typeId),
		primeSpeed: int(raw.vsp_prime_speed),
		primeDurationMinutes: int(raw.vsp_prime_duration),
		freezeProtectSpeed: int(raw.vsp_freeze_protect_speed),
	};
}

/**
 * Pump serials the panel can see on its bus but that no slot has claimed. Raw
 * because the answer is an envelope around a list of strings and there is
 * nothing in it worth renaming. Unverified.
 */
export function getUnassignedSerials(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_UNASSIGNED_SERIALS);
}

/**
 * Pump commissioning, verbatim from the protocol reference.
 *
 * Every one of these teaches the panel a fact about hardware rather than
 * telling it to do something, and a wrong fact persists — a slot pointed at the
 * wrong serial keeps answering for a pump that is not there. None has been seen
 * on the wire by anyone, upstream implements none of them, and none is reachable
 * from diagnostics, because a diagnostics row fires on click and these are not
 * things to find out about by clicking.
 */
export function setVspName(
	serial: string,
	slotId: number,
	name: string,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_VSP_NAME, {
		slot_id: String(slotId),
		pump_name: name,
	});
}

/**
 * The seven things `set_vsp_definition` can change, one per request.
 *
 * The first port of this command sent `app_id` and `model_typeid` together,
 * which is the one shape no source anywhere shows. The vendor's own client
 * builds this query string seven different ways and never puts two fields in
 * one request — so a partial update it is, and the other five fields, which
 * that port could not express at all, are what the panel's own priming and
 * freeze-protection speeds are set through.
 *
 * `freezeprotect_speed` has no underscore between "freeze" and "protect", while
 * the field it sets back is read as `vsp_freeze_protect_speed`. That asymmetry
 * is the wire's, not a typo.
 */
export type VspDefinitionField =
	| "app_id"
	| "model_typeid"
	| "min_speed"
	| "max_speed"
	| "prime_speed"
	| "prime_duration"
	| "freezeprotect_speed";

export function setVspDefinitionField(
	serial: string,
	slotId: number,
	field: VspDefinitionField,
	value: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_VSP_DEFINITION, {
		slot_id: String(slotId),
		[field]: String(Math.round(value)),
	});
}

export function assignVspSerial(
	serial: string,
	slotId: number,
	pumpSerial: string,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ASSIGN_VSP_SERIAL, {
		slot_id: String(slotId),
		vsp_serial: pumpSerial,
	});
}

export function unassignVspSerial(
	serial: string,
	slotId: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_UNASSIGN_VSP_SERIAL, {
		slot_id: String(slotId),
	});
}

/**
 * Bind an aux relay to one of a pump's speeds. This is the write side of the
 * `aux_speed_assignments` list `getPumpSpeeds` reads to work out which relay a
 * pump belongs to, so changing it moves a pump from one relay to another as far
 * as the whole app is concerned.
 *
 * `auxId` is 1-based and indexes the panel's own aux order — position 1 is the
 * first aux `get_devices` lists, which is `aux_1` on a bare panel but keeps
 * counting into the lettered expansion banks past the seventh, where the names
 * stop being `aux_N`. Clearing an assignment is `speedId: 0` with the aux still
 * named; there is no unassign command and the aux is never omitted.
 */
export function setAuxSpeed(
	serial: string,
	slotId: number,
	speedId: number,
	auxId: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_AUX_SPEED, {
		slot_id: String(slotId),
		speed_id: String(speedId),
		aux_id: String(auxId),
	});
}

/**
 * Rename a speed preset, and set what it is worth.
 *
 * These spell the preset `speedname_id` where the run commands spell it
 * `speed_id`, which read as two id spaces nobody had reconciled. They are one
 * number: the vendor's client parses `speedid` out of `get_vsp_speedauxinfo`
 * once and emits that single value under whichever name the command in hand
 * wants. So a preset's run id *is* its name id — but the two spellings stay,
 * because the panel is what insists on them.
 */
export function setSpeedName(
	serial: string,
	slotId: number,
	speedNameId: number,
	name: string,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_SPEED_NAME, {
		slot_id: String(slotId),
		speedname_id: String(speedNameId),
		speed_name: name,
	});
}

export function setSpeedNameValue(
	serial: string,
	slotId: number,
	speedNameId: number,
	value: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_SET_SPEEDNAME_VALUE, {
		slot_id: String(slotId),
		speedname_id: String(speedNameId),
		speed_value: String(Math.round(value)),
	});
}

/**
 * Run a pump at a speed it has no preset for.
 *
 * The only command on the pad that carries a raw speed rather than picking one
 * of the eight an installer configured. Upstream marks arbitrary-RPM writes as
 * unconfirmed for iaqua, and the risk here is not a rejected request: presets
 * exist because someone decided what this plumbing can carry, and a value
 * outside them drives a real motor. Nothing here clamps it — the bounds belong
 * to whoever knows the pump, and `getVspDefinition` reports them. Unverified.
 */
export function enablePumpSpeedValue(
	serial: string,
	slotId: number,
	speedNameId: number,
	value: number,
	on = true,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ENABLE_PUMP_SPEED_VALUE, {
		slot_id: String(slotId),
		speedname_id: String(speedNameId),
		speed_value: String(Math.round(value)),
		on_off_action: on ? "on" : "off",
	});
}

/** One variable-speed pump the panel has an actual pump wired to. */
export interface VspPump {
	/** Pump slot. Doubles as `slot_id` on every VSP command. */
	pumpId: number;
	/**
	 * Whether the panel reported an active speed — its only way of saying the
	 * pump is running, since a speed-started pump never closes its aux relay.
	 * Distinct from `speeds[].active`, which the query layer also restores
	 * from local memory while the pump is off.
	 */
	running: boolean;
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
				running: slot.speeds.some((s) => s.active),
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

/** One of the panel's twenty pump slots, whether or not a pump answers for it. */
export interface VspSlot {
	/** 1-based, and the `slot_id` every VSP command takes. */
	slotId: number;
	name: string;
	appId: number;
	/** "Filtration", "Aux Pump", or "Not Installed" for an empty slot. */
	appName: string;
	model: string;
	modelTypeId: number;
	/** The physical pump's own serial. Empty for slots 1-4, which have none. */
	pumpSerial: string;
	installed: boolean;
}

/**
 * Every pump slot the panel has, empty ones included.
 *
 * Two requests for all twenty, not one per slot: `get_vsp_names` and
 * `get_vsp_appmodelserials` each answer for the whole table. `listVspPumps`
 * already asks both and then throws the empty slots away, which is right for a
 * screen that runs pumps and wrong for one that sets them up — an empty slot is
 * a row a setup page has to draw.
 *
 * `appId` is what separates a real pump from a stub, not the name: an
 * unconfigured slot is still called "PumpN" and still reports a full speed
 * table, all of it factory defaults.
 */
export async function getVspSlots(serial: string): Promise<VspSlot[]> {
	const [names, models] = await Promise.all([
		getVspNames(serial),
		getVspAppModelSerials(serial),
	]);

	const named = new Map<number, string>();
	for (const n of rows(names.vsp_names)) {
		named.set(Number(n.pumpId), String(n.pumpName ?? ""));
	}

	return rows(models.vsp_app_model_serials).map((m) => {
		const slotId = Number(m.pumpId);
		const appId = int(m.appId) ?? 0;
		return {
			slotId,
			name: named.get(slotId) || `Pump ${slotId}`,
			appId,
			appName: String(m.appName ?? ""),
			model: String(m.modelName ?? ""),
			modelTypeId: int(m.modelType) ?? 0,
			pumpSerial: String(m.pumpSerial ?? ""),
			installed: appId !== 0,
		};
	});
}

/** A slot's eight speeds and its aux bindings, as configuration rather than state. */
export interface VspSlotSetup {
	min: number;
	max: number;
	/** All eight, placeholder names kept — naming them is the point here. */
	speeds: VspSpeed[];
	/** How many aux positions the panel offers bindings for. */
	auxCount: number;
	/**
	 * Position n (1-based) holds the speed id that aux runs at, or 0 for none.
	 * Both directions of the mapping come off this: which aux a speed drives is
	 * a search through it.
	 */
	auxSpeeds: number[];
}

/**
 * One slot's speed table, read for editing rather than for running.
 *
 * Deliberately not `getPumpSpeeds`, which drops the speeds still carrying a
 * placeholder name. That is the correct read for a control that offers speeds
 * to pick between, and exactly the wrong one here: a speed called "Speed4" is
 * the one the owner has come to this page to name.
 *
 * `enabled` is not read at all. It reports which speed the pump is running now,
 * which is state this page has no business showing — the equipment page owns
 * that, and a setup screen that redrew itself because someone turned a pump on
 * would be lying about what it edits.
 */
export async function getVspSlotSpeeds(
	serial: string,
	slotId: number,
): Promise<VspSlotSetup> {
	const raw = await getVspSpeeds(serial, slotId);
	const speeds: VspSpeed[] = rows(raw.vsp_speedInfo).map((s) => ({
		id: Number(s.speedid),
		name: String(s.speedName ?? ""),
		rpm: Number(s.speedvalue),
		active: s.enabled === "true",
	}));

	// The list runs one entry longer than `aux_count` and ends in "Absent",
	// a terminator rather than a thirty-third aux, so the count is what bounds
	// it. Every other entry is a speed id or "No".
	const auxCount = int(raw.aux_count) ?? 0;
	const assignments = Array.isArray(raw.aux_speed_assignments)
		? (raw.aux_speed_assignments as unknown[])
		: [];
	const auxSpeeds = Array.from({ length: auxCount }, (_, i) => {
		const a = String(assignments[i] ?? "");
		return /^\d+$/.test(a) ? Number(a) : 0;
	});

	return {
		min: Number(raw.minSpeed),
		max: Number(raw.maxSpeed),
		speeds,
		auxCount,
		auxSpeeds,
	};
}

/**
 * Seven numbered aux relays, then three banks of eight, then one more.
 *
 * The panel's aux naming stops being a number after the seventh: aux_1 to
 * aux_7, then aux_B1 to aux_D8 for the expansion banks, then aux_EA. Every
 * panel answers with the whole space whatever its size, which is why this can
 * be worked out from a name rather than counted off a device list — and why it
 * still holds for a pad that leaves gaps in the one it sends.
 */
const AUX_NUMBERED = 7;
const AUX_BANKS = ["B", "C", "D"];
const AUX_BANK_SIZE = 8;

/**
 * Where an aux sits in the panel's own aux order, 1-based, or 0 for a name
 * that is not one.
 *
 * This is the number `aux_speed_assignments` is indexed by — position n of
 * that list is the nth aux — so it is the only thing that ties a pump's speed
 * to the relay that runs it. Reading the trailing digits as the position is
 * what it used to do, and that is right for exactly the first seven: aux_B1 is
 * the eighth aux and not the first, so a pump wired to any expansion bank
 * resolved to the wrong relay or to none.
 */
export function auxPosition(deviceName: string | undefined): number {
	const m = /^aux_([A-Za-z]?)(\d+|[Aa])$/.exec(deviceName ?? "");
	if (!m) return 0;
	const bank = m[1].toUpperCase();
	const slot = m[2].toUpperCase();

	if (!bank) {
		const n = Number(slot);
		return n >= 1 && n <= AUX_NUMBERED ? n : 0;
	}

	const b = AUX_BANKS.indexOf(bank);
	if (b >= 0) {
		const n = Number(slot);
		return n >= 1 && n <= AUX_BANK_SIZE
			? AUX_NUMBERED + b * AUX_BANK_SIZE + n
			: 0;
	}

	// The last one is lettered rather than numbered, so it is named outright.
	if (bank === "E" && slot === "A")
		return AUX_NUMBERED + AUX_BANKS.length * AUX_BANK_SIZE + 1;
	return 0;
}

/** The pump driving a device, matched on the aux relay the device sits on. */
export function pumpForDevice(
	pumps: VspPump[] | undefined,
	deviceName: string | undefined,
): VspPump | undefined {
	const n = auxPosition(deviceName);
	if (!n) return undefined;
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

// -- Salt water chlorinator --

/** What `boostcontrol` takes. Hours and circuit only mean anything on start. */
export type SwcBoostControl = "start" | "stop" | "pause" | "resume";

/**
 * The chlorinator's configuration, as all three SWC commands report it — the
 * two writes echo back exactly what the read returns, so nothing downstream has
 * to predict the result of a write or wait a poll to learn it.
 */
export interface SwcConfig {
	/** Configured output percent per body, 0-100. Two values, never one. */
	poolSetPoint: number;
	spaSetPoint: number;
	/** "" when no boost is running, otherwise "on" or "paused". */
	boostStatus: string;
	boostOn: boolean;
	/** How long a started boost runs for, in hours. */
	boostHours: number;
	/** What is left of a running boost. Zero when none is. */
	remainingMinutes: number;
	/** "pool" or "spillover" — which circuit a boost chlorinates. */
	boostMode: string;
	/**
	 * Whether the panel offers a choice of which circuit a boost chlorinates.
	 *
	 * `boostDipSwitch` reports switch 3 on the power centre bezel, and the
	 * AquaLink RS manual is specific about what it does: with it on, the Boost
	 * Setup menu offers a MODE alongside the hours; with it off, "then only TIME
	 * is displayed". So this gates the `boostmode` parameter and nothing else —
	 * boost itself works either way, and gating the whole control on it would
	 * take a working feature away from every pad without spillover plumbing.
	 *
	 * False when the field is missing, which is the safe direction: not sending
	 * `boostmode` leaves the panel running the mode it was configured with.
	 */
	boostModeAvailable: boolean;
}

const percent = (v: unknown): number | null => {
	const n = Number(v);
	// A blank field parses as 0, which for an output set point is not "unknown"
	// but "stop producing" — and it would be written straight back on the next
	// change to the other body. Empty has to stay empty all the way up.
	if (v === "" || v == null || !Number.isFinite(n)) return null;
	return Math.min(100, Math.max(0, Math.round(n)));
};

const whole = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/**
 * Shape a command's answer, or null if it is not a configuration at all.
 *
 * The set points are the test. A body without them — an error the pool chose
 * to send with a 200, a panel that does not know the command, a shape nobody
 * has captured — must not become a SwcConfig, because the very next write
 * would send both of its zeroes to a working cell.
 */
function readSwcConfig(raw: Raw): SwcConfig | null {
	const pool = percent(raw.poolSWCSP);
	const spa = percent(raw.spaSWCSP);
	if (pool === null) return null;

	const status = String(raw.boostStatus ?? "")
		.trim()
		.toLowerCase();
	return {
		poolSetPoint: pool,
		// A cell on a pool-only pad reports no spa side; echoing its own value
		// back is the only write that cannot change something we cannot see.
		spaSetPoint: spa ?? 0,
		boostStatus: status,
		// Paused is still a boost — it holds its remaining time and resumes —
		// so a switch that read only "on" would offer to start one already running.
		boostOn: status === "on" || status === "paused",
		boostHours: whole(raw.boostHrsVal),
		remainingMinutes:
			whole(raw.remainingBoostHrs) * 60 + whole(raw.remainingBoostMins),
		boostMode: String(raw.boostMode ?? "")
			.trim()
			.toLowerCase(),
		boostModeAvailable:
			String(raw.boostDipSwitch ?? "")
				.trim()
				.toLowerCase() === "on",
	};
}

/** Read the chlorinator's set points and boost state. */
export async function getSwcConfig(serial: string): Promise<SwcConfig> {
	const raw = await client.sessionRequest(serial, CMD_GET_SWC_CONFIG);
	const config = readSwcConfig(raw);
	if (!config)
		throw new AqualinkError(
			"No chlorinator configuration reported",
			undefined,
			raw,
		);
	return config;
}

/**
 * Set one body's output percent, carrying the other unchanged.
 *
 * Both parameters ride every write — the panel takes the pair, not one of them
 * — so the untouched side must be a real current value and never a blank or a
 * guess. Exactly the trap set_temps has with its two bodies, and the caller
 * seeds it the same way.
 */
export async function setSwcOutput(
	serial: string,
	poolPercent: number,
	spaPercent: number,
): Promise<SwcConfig | null> {
	return readSwcConfig(
		await client.sessionRequest(serial, CMD_SET_SWC_CONFIG, {
			poolswcsp: String(percent(poolPercent) ?? 0),
			spaswcsp: String(percent(spaPercent) ?? 0),
		}),
	);
}

/** Start, stop, pause or resume a boost. Only a start carries hours and mode. */
export async function controlSwcBoost(
	serial: string,
	control: SwcBoostControl,
	hours?: number,
	mode?: string,
): Promise<SwcConfig | null> {
	const params: Payload = { boostcontrol: control };
	if (hours !== undefined) params.boosthrs = String(Math.round(hours));
	if (mode) params.boostmode = mode;
	return readSwcConfig(
		await client.sessionRequest(serial, CMD_CONTROL_SWC_BOOST, params),
	);
}

// -- ICL light zones --

/**
 * The zone list as a read of its own.
 *
 * Zones normally arrive folded into `get_devices` as `icl_info_list`, which is
 * how `devicesScreen` gets them. What only this read can say is `zoneCount` —
 * the panel's own count of configured zones, which the folded copy has no field
 * for, leaving "no zones" and "the panel did not mention any" indistinguishable
 * from an empty array.
 *
 * Whether it says anything else the copy does not is unsettled, and the two
 * halves of upstream disagree. Its protocol reference tables the `get_devices`
 * copy without the RGBW channels a zone set to Custom Color needs; its test
 * fixture and its parser both carry RGBW on that copy, and its implementation
 * notes call the two "redundant data — no zone data is lost". The fixture is
 * synthetic, so neither side is a capture. `buildZones` takes the union rather
 * than picking a winner.
 *
 * On the timeout: upstream's code comment says flatly "get_icl_info times out
 * on hardware", but its PR and implementation notes both soften that to *some*
 * hardware, and no source names the pad, the duration, or whether it hangs or
 * errors. Upstream never shipped the call at all — there is no command constant
 * for it — so the warning is a reason they declined to find out rather than a
 * measurement. Against this panel it answered in well under a second. That is
 * one pad, and a pad with no zones; a pad that does hang is still possible,
 * which is why the query that calls this is gated, slow, and never something
 * the screen waits on.
 */
export function iclGetInfo(serial: string): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_GET_INFO);
}

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

/**
 * Brightness rides the same command as colour, with `color_id` left off so the
 * zone keeps whatever it is showing. `set_iclzone_dim` does exist — see
 * `iclSetZoneDim` — but no observed path in the vendor's own app has ever sent
 * it, and this is the call the panel demonstrably handles.
 */
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

/**
 * Brightness through its own command rather than through the colour one.
 *
 * Present in the vendor's app sources and named by the protocol reference, but
 * no observed app path sends it — which means the panel's handling of it is
 * untested by anybody, including the vendor. `iclSetBrightness` is the call to
 * use; this exists so the surface is complete and so the two can be compared if
 * the colour-command route ever misbehaves. Unverified.
 */
export function iclSetZoneDim(
	serial: string,
	zoneId: number,
	dimLevel: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_SET_DIM, {
		zone_id: String(zoneId),
		dim_level: String(Math.round(dimLevel)),
	});
}

/**
 * Rename a zone as the panel and every app will show it.
 *
 * The zone hero sends this, which makes it the only ICL write here that has
 * never been captured and is still reachable from a screen. That is a
 * deliberate line: what this command can get wrong is a label, and the same
 * control that set it sets it again. Everything else unexercised in this group
 * changes which fixture answers to what.
 *
 * Two things are unverified rather than one. `name_val` is the reference's
 * spelling and matches nothing else on this pad — `set_vsp_name` takes
 * `pump_name`, `set_speed_name` takes `speed_name` — so a rejection is a real
 * possibility, and it is a harmless one. And nothing anywhere states a maximum
 * length; the caller trims and `ICL_ZONE_NAME_MAX` explains the bound the app
 * imposes on its own initiative. A name is trimmed here rather than only in the
 * form, because whitespace is the one thing a panel is certain to keep and an
 * owner is certain not to have meant.
 */
export function iclSetZoneName(
	serial: string,
	zoneId: number,
	name: string,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_SET_NAME, {
		zone_id: String(zoneId),
		name_val: name.trim().slice(0, ICL_ZONE_NAME_MAX),
	});
}

/**
 * Turn zoning mode on or off, and get back the fixture inventory.
 *
 * The response is the only place `DCT_info_list` appears: every physical light
 * the pad can see, which transmitter it hangs off, and which zone it currently
 * belongs to. That inventory is what `iclMoveLight` needs as input, and there
 * is no read-only way to obtain it — the command that reports it is the command
 * that regroups every fixture on the pad. That is why it is not a probe.
 * Unverified.
 *
 * Nothing calls this, and the deciding reason is not the risk but the absence of
 * a read. No command reports `zoning_mode_status` — `get_icl_info` returns zones
 * and nothing else — so a switch wired to this would have to render some
 * position before it could know one, and the only way to discover the real one
 * would be to flip it and read the answer. Regrouping every fixture on a pad to
 * find out how they are currently grouped is not a thing to offer.
 */
export function iclZoningMode(serial: string, on: boolean): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_ZONING_MODE, {
		on_off_action: on ? "on" : "off",
	});
}

/**
 * Move one fixture into a different zone. Ids come from `DCT_info_list`.
 *
 * Also uncalled, and for a reason that follows from the one above rather than
 * standing on its own: `dct_id` and `light_id` live in an id space that exists
 * nowhere but the `enable_disable_zoning_mode` response. With that command
 * unsent, no part of this app has ever held a real pair, and there is nothing to
 * infer them from — a zone knows its own id and says nothing about the fixtures
 * inside it. Sending a guessed pair reassigns somebody's light and gives the app
 * no way to say which one moved or to put it back.
 */
export function iclMoveLight(
	serial: string,
	dctId: number,
	lightId: number,
	zoneId: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_ICL_MOVE_LIGHTS, {
		dct_id: String(dctId),
		light_id: String(lightId),
		zone_id: String(zoneId),
	});
}

// -- Schedules --

/** One timed program the panel runs on its own. */
export interface Schedule {
	id: number;
	/**
	 * What the schedule runs. This is `get_master_device_list`'s id space and
	 * not an aux key, so a schedule cannot be named for an owner without joining
	 * the two reads — the schedule list alone says "device 3", never "Waterfall".
	 */
	deviceId: number;
	startHrs: number;
	startMins: number;
	stopHrs: number;
	stopMins: number;
	/**
	 * When the schedule runs, as one of a closed set of words — "AllDays",
	 * "Weekdays", "Weekends" or a single day like "Wednesday". Never a list and
	 * never a mask: the panel holds one of these, not a set of days. Typed as a
	 * plain string because a pad may name a day some spelling nobody has seen,
	 * and a schedule this app cannot name is still a schedule it must list.
	 */
	days: string;
	/** Set when the schedule drives a variable-speed pump rather than a relay. */
	vspId: number | null;
}

export interface ScheduleList {
	schedules: Schedule[];
	/**
	 * The panel's own count. `getScheduleList` pages until it has them all, so
	 * this should equal `schedules.length`; a shortfall means the panel stopped
	 * answering mid-walk and is worth surfacing rather than quietly truncating.
	 */
	total: number;
	/** Whether the panel has room for another schedule. */
	canAdd: boolean;
}

/**
 * Whether the panel will accept another schedule.
 *
 * `isNewScheduleAllowed` is a *string* — this pad says "Allowed" — where the
 * protocol reference calls it a boolean. That mismatch is not cosmetic: the
 * obvious `!== false` test passes for "Allowed" and for "NotAllowed" alike, so
 * a full panel would still be offered an Add button that could only fail.
 *
 * Read as a yes rather than as a list of noes, which is the opposite of how
 * `iclPresent` reads its field, and deliberately: there the cost of guessing
 * wrong is one rejected request, while here it is a control that lies about
 * what the hardware can do. An absent field still means yes, because a panel
 * old enough not to report this is a panel with nothing to say against it.
 */
function readCanAdd(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (value === undefined || value === null) return true;
	return String(value).trim().toLowerCase() === "allowed";
}

/**
 * Shape a schedule reply, or null when the body is not one.
 *
 * `scheduleList` has to be an array. A panel that does not know the command may
 * still answer 200 with an explanation, and a pad with no programs answers with
 * an empty array — those two are different facts and coercing the first into
 * the second would report "no schedules" for "no such command".
 */
function readScheduleList(raw: Raw): ScheduleList | null {
	if (!Array.isArray(raw.scheduleList)) return null;
	const schedules = rows(raw.scheduleList).map(
		(s): Schedule => ({
			id: int(s.id) ?? 0,
			deviceId: int(s.deviceId) ?? 0,
			startHrs: int(s.startHrs) ?? 0,
			startMins: int(s.startMins) ?? 0,
			stopHrs: int(s.stopHrs) ?? 0,
			stopMins: int(s.stopMins) ?? 0,
			days: String(s.scheduleDays ?? ""),
			vspId: int(s.vspId),
		}),
	);
	return {
		schedules,
		total: int(raw.totalCount) ?? schedules.length,
		canAdd: readCanAdd(raw.isNewScheduleAllowed),
	};
}

/**
 * How many pages of schedules to ask for before giving up on the walk.
 *
 * `pageNum` is a real request parameter — the panel accepts it and echoes it
 * back, both in the JSON and in the raw byte header — which the protocol
 * reference does not mention at all. What it does not say is how many
 * schedules fit on a page: this pad returned six on page zero and nothing
 * after, so the size is only known to be at least six.
 *
 * The walk therefore stops on the panel's own `totalCount` or on an empty
 * page, and this is the backstop for neither happening. A pad that answered
 * every page with the same schedules would otherwise spin here forever, and
 * ten pages is far past any plausible number of programs while still being a
 * bounded number of requests to a device that answers one command at a time.
 */
const SCHEDULE_PAGE_LIMIT = 10;

/**
 * Read the panel's timed programs, walking the pages until it has them all.
 *
 * Until this command, schedules were the headline example of something this app
 * could not reach — `webtouchUrl`'s comment names them as the reason that link
 * exists at all. They are readable: the pad answers, and the reply is the
 * panel's own programs, the ones that re-assert themselves over anything this
 * app asks for.
 *
 * Throws with the raw body attached when the reply is not a schedule list, so a
 * rejection reads as its own explanation rather than as an empty schedule.
 */
export async function getScheduleList(serial: string): Promise<ScheduleList> {
	const raw = await client.sessionRequest(serial, CMD_GET_SCHEDULE_LIST);
	const first = readScheduleList(raw);
	if (!first)
		throw new AqualinkError("No schedule list reported", undefined, raw);

	const schedules = [...first.schedules];
	for (
		let page = 1;
		schedules.length < first.total && page < SCHEDULE_PAGE_LIMIT;
		page++
	) {
		const next = readScheduleList(
			await client.sessionRequest(serial, CMD_GET_SCHEDULE_LIST, {
				pageNum: String(page),
			}),
		);
		// A page that is empty or unreadable ends the walk rather than failing
		// it: the schedules already in hand are real, and reporting them with a
		// short `total` says so more usefully than throwing them away.
		if (!next?.schedules.length) break;
		schedules.push(...next.schedules);
	}

	return { ...first, schedules };
}

/** One entry in the panel's id↔name table. */
export interface ScheduleDevice {
	id: number;
	name: string;
	/** Whether this id addresses a pump's speed rather than a plain relay. */
	isVsp: boolean;
}

/**
 * The equipment a schedule can name, by the id space schedules actually use.
 *
 * `listType` is what decides the question asked. `1` is everything the panel
 * can schedule and is what an Add picker wants; `0` is narrower and, on this
 * pad, returned exactly the devices that already had a schedule — it grew from
 * three entries to six in step with schedules being added, which is what
 * settles it as "already scheduled" rather than "basic equipment". `2` needs a
 * `vspId` alongside it and answers with one pump's named speeds instead.
 *
 * Names arrive padded with NULs in the panel's own byte payload; the JSON is
 * already trimmed, so nothing here has to undo that.
 */
export async function getScheduleDevices(
	serial: string,
	listType: "0" | "1" = "1",
): Promise<ScheduleDevice[]> {
	return readDeviceList(await getMasterDeviceList(serial, listType));
}

function readDeviceList(raw: Raw): ScheduleDevice[] {
	if (!Array.isArray(raw.deviceList))
		throw new AqualinkError("No device list reported", undefined, raw);
	return rows(raw.deviceList).map(
		(d): ScheduleDevice => ({
			id: int(d.id) ?? 0,
			name: String(d.name ?? "").trim(),
			isVsp: String(d.isVSP ?? "").toLowerCase() === "yes",
		}),
	);
}

/** One of a pump's configured speeds, in the id space a schedule names. */
export interface ScheduleSpeed {
	/** The speed's own id — this is what a speed schedule puts in `deviceId`. */
	id: number;
	name: string;
	/** The pump that owns it, which the schedule carries as `vspId`. */
	pumpId: number;
	pumpName: string;
}

/**
 * The speeds every variable-speed pump on this panel offers, in one table.
 *
 * A schedule against a pump speed is addressed in a way worth stating plainly,
 * because it is the reverse of what the field names suggest: `deviceId` holds
 * the *speed* and `vspId` holds the *pump*. A real one from this pad reads
 * `deviceId: 110, vspId: 54` — speed 110 is "Low", pump 54 is the waterfall.
 * So the schedule list alone cannot name such a program at all: 110 does not
 * appear in the device list a schedule is otherwise read through, and without
 * this table the row says "Device 110".
 *
 * One request per pump, because `listType=2` answers about one pump at a time.
 * They are sent in series rather than at once — the panel works through
 * commands one by one, and three parallel asks would only queue behind each
 * other with less to show for it. A pump that fails to answer is skipped
 * rather than failing the lot, since a table missing one pump still names
 * every schedule belonging to the others.
 */
export async function getScheduleSpeeds(
	serial: string,
	pumps: readonly ScheduleDevice[],
): Promise<ScheduleSpeed[]> {
	const speeds: ScheduleSpeed[] = [];
	for (const pump of pumps) {
		try {
			const list = readDeviceList(
				await getMasterDeviceList(serial, "2", pump.id),
			);
			for (const s of list)
				speeds.push({
					id: s.id,
					name: s.name,
					pumpId: pump.id,
					pumpName: pump.name,
				});
		} catch {
			// Named by its number on the row rather than not listed at all.
		}
	}
	return speeds;
}

/** The fields an added or edited schedule carries. */
export interface ScheduleSpec {
	deviceId: number;
	startHrs: number;
	startMins: number;
	stopHrs: number;
	stopMins: number;
	/**
	 * One of the words the panel uses for when a schedule runs — see
	 * `SCHEDULE_DAYS`. The reference's "All Days" is not one of them; the pad
	 * says "AllDays", and it also says "Weekdays", "Weekends" and single days
	 * like "Wednesday". Only ever one value, never a list.
	 */
	days: string;
	/**
	 * The pump, when this program runs one of its speeds rather than a relay.
	 *
	 * The pairing is the reverse of what the two names suggest, and it is worth
	 * stating because getting it backwards would point a program at the wrong
	 * equipment: `deviceId` holds the *speed* and this holds the *pump that owns
	 * it*. A real one off this pad reads `deviceId: 110, vspId: 54` — speed 110
	 * is "Low" and pump 54 is the waterfall.
	 *
	 * Null or absent for an ordinary on/off program, and left off the request
	 * entirely in that case rather than sent empty. An edit must carry back
	 * whatever the schedule already had: dropping it would turn a speed program
	 * into a plain one addressed by a device number that means nothing on its
	 * own.
	 */
	vspId?: number | null;
}

function scheduleParams(spec: ScheduleSpec): Payload {
	return {
		deviceId: String(spec.deviceId),
		startHrs: String(spec.startHrs),
		startMins: String(spec.startMins),
		stopHrs: String(spec.stopHrs),
		stopMins: String(spec.stopMins),
		scheduleDays: spec.days,
		...(spec.vspId == null ? {} : { vspId: String(spec.vspId) }),
	};
}

/**
 * Add, edit and delete are one command with an `operation` parameter, split
 * into three here because they do not take the same fields: an edit needs both
 * the id and the whole spec, a delete needs only the id, and one function
 * taking every parameter optionally would let a caller send an edit with no id
 * — which is an add the panel was not asked for.
 *
 * All three have now been run against a real panel — added, edited and deleted
 * — which is worth recording because for a while nothing had. The parameter
 * names came from a protocol reference that was wrong about the *read* in five
 * separate ways: a day value with no space in it, a string where it promised a
 * boolean, a page parameter it never documented. On the write it was right.
 *
 * What that does not settle is every value these can carry. The operation
 * names, the field names and the id both edit and delete take are confirmed;
 * the individual weekday spellings in `SCHEDULE_DAYS` are a separate question,
 * and most of those are still inferred rather than seen.
 */
export async function addSchedule(
	serial: string,
	spec: ScheduleSpec,
): Promise<ScheduleList | null> {
	return readScheduleList(
		await client.sessionRequest(serial, CMD_DO_SCHEDULE_OPERATION, {
			operation: "Add",
			...scheduleParams(spec),
		}),
	);
}

export async function editSchedule(
	serial: string,
	scheduleId: number,
	spec: ScheduleSpec,
): Promise<ScheduleList | null> {
	return readScheduleList(
		await client.sessionRequest(serial, CMD_DO_SCHEDULE_OPERATION, {
			operation: "Edit",
			scheduleId: String(scheduleId),
			...scheduleParams(spec),
		}),
	);
}

export async function deleteSchedule(
	serial: string,
	scheduleId: number,
): Promise<ScheduleList | null> {
	return readScheduleList(
		await client.sessionRequest(serial, CMD_DO_SCHEDULE_OPERATION, {
			operation: "Delete",
			scheduleId: String(scheduleId),
		}),
	);
}

// -- TruSense pH/ORP --

/** A decimal wire field. pH is the one reading here that is not a whole number. */
const dec = (v: unknown): number | null => {
	if (v === "" || v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/**
 * A TruSense probe's own report of the water.
 *
 * The same two numbers reach `get_home` as `ph` and `orp`, so this is not how
 * the app learns the chemistry. What it adds is the per-channel status string:
 * `get_home` reports a number whether or not the probe behind it is working,
 * and a reading from a failed or drifted sensor looks exactly like a good one.
 *
 * Take the values as reported. The flat `get_home` fields are scaled integers —
 * Goose66 multiplies `ph` by 0.1 and `orp` by 10 to get real units — and whether
 * this command scales the same way has never been observed. Applying that
 * factor here on the assumption they match would silently move a pH by a decade.
 */
export interface PhOrpReading {
	ph: number | null;
	/** The probe's word for its own pH channel. Empty when it did not say. */
	phStatus: string;
	orp: number | null;
	orpStatus: string;
}

/**
 * Read the pH/ORP probe. `unitId` addresses the sensor unit; the reference
 * confirms it is an integer but has never seen a live value, so the valid range
 * is unknown and the diagnostics probes try the low ids rather than assume one.
 */
export async function getPhOrpValues(
	serial: string,
	unitId = 1,
): Promise<PhOrpReading> {
	const raw = await client.sessionRequest(serial, CMD_GET_PHORP_VALUES, {
		unit_id: String(unitId),
	});
	const ph = dec(raw.pH_value);
	const orp = dec(raw.ORP_value);
	// Neither channel reporting means this is not a reading — most likely a
	// rejection, or a unit id nothing answers to. Either way the raw body says
	// more than a pair of nulls would.
	if (ph === null && orp === null)
		throw new AqualinkError("No pH/ORP reading reported", undefined, raw);
	return {
		ph,
		phStatus: String(raw.pH_sensor_status ?? ""),
		orp,
		orpStatus: String(raw.ORP_sensor_status ?? ""),
	};
}

/**
 * When each channel was last calibrated, and whether it ever was. Raw: the
 * payload is two nested day/month/year objects beside a handful of status
 * strings, and there is no shape to impose on it that a caller would not
 * immediately have to take apart again.
 */
export function getPhOrpLastCalibration(
	serial: string,
	unitId = 1,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_PHORP_LASTCALIBINFO, {
		unit_id: String(unitId),
	});
}

/** The same shape, reporting a calibration in progress rather than the last one. */
export function getPhOrpCalibrationStatus(
	serial: string,
	unitId = 1,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_GET_PHORP_CALIBSTATUS, {
		unit_id: String(unitId),
	});
}

/**
 * Start a calibration.
 *
 * These are not reads dressed as writes: each one begins a physical procedure
 * at the probe, and a calibration completed against the wrong reference leaves
 * the sensor confidently wrong about the water — the pH the app then shows is
 * indistinguishable from a correct one, which is the failure that matters. They
 * belong behind a guided flow that says which solution to use and when, never
 * behind a button that fires on click, and that is why none is a probe.
 *
 * Unverified, all three: no client implements them and the two-point flow's
 * `step_no` sequence is documented nowhere.
 */
export function calibratePh1Point(
	serial: string,
	unitId: number,
	phValue: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_DO_1POINT_PH_CALIBRATION, {
		unit_id: String(unitId),
		ph_value: String(phValue),
	});
}

export function calibratePh2Point(
	serial: string,
	unitId: number,
	step: number,
): Promise<Raw> {
	return client.sessionRequest(serial, CMD_DO_2POINT_PH_CALIBRATION, {
		unit_id: String(unitId),
		step_no: String(step),
	});
}

export function calibrateOrp(serial: string, unitId: number): Promise<Raw> {
	return client.sessionRequest(serial, CMD_DO_ORP_CALIBRATION, {
		unit_id: String(unitId),
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

// Same as query-client.ts: the singleton holds the in-memory session, and an
// HMR re-run would split it from the tree still rendering the old module.
if (import.meta.hot)
	import.meta.hot.accept(() => import.meta.hot?.invalidate());

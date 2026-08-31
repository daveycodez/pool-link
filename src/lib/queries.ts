import {
	skipToken,
	useIsMutating,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import type {
	ScheduleDevice,
	ScheduleList,
	ScheduleSpec,
	SwcBoostControl,
	SwcConfig,
	VspDefinition,
	VspDefinitionField,
	VspPump,
	VspSlot,
	VspSlotSetup,
} from "#/lib/aqualink/client";
import {
	addDevice,
	addSchedule,
	calibrateOrp,
	calibratePh1Point,
	controlSwcBoost,
	deleteSchedule,
	devicesScreen,
	editSchedule,
	enableHpm,
	getDeviceStatus,
	getScheduleDevices,
	getScheduleList,
	getScheduleSpeeds,
	getSwcConfig,
	getVspDefinition,
	getVspSlotSpeeds,
	getVspSlots,
	homeScreen,
	iclGetInfo,
	iclSetBrightness,
	iclSetColor,
	iclSetCustomColor,
	iclSetZoneName,
	iclZoneOnOff,
	listSystems,
	listVspPumps,
	login,
	logout,
	onetouchScreen,
	pumpForDevice,
	setAuxSpeed,
	setDeviceName,
	setDimmerLevel,
	setHpmSetPoint,
	setLightColor,
	setOnetouch,
	setSpeedName,
	setSpeedNameValue,
	setSwcOutput,
	setTemps,
	setVspDefinitionField,
	setVspName,
	setVspSpeed,
	switchHpmMode,
	toggleDevice,
} from "#/lib/aqualink/client";
import { HPM_TEMP_PARAM, SWC_BOOST_HOURS } from "#/lib/aqualink/enums";
import {
	loadSession,
	sessionRefused,
	watchRefusal,
} from "#/lib/aqualink/session";
import { AqualinkError } from "#/lib/aqualink/types";
import {
	type PhOrpCalibration,
	readPhOrp,
	readPhOrpCalibration,
} from "#/lib/chemistry";
import { clearHeatRuns } from "#/lib/heat-eta";
import { iclPresent, normalize } from "#/lib/iaqualink/normalize";
import type { PoolDevice, PoolSnapshot, Raw } from "#/lib/iaqualink/types";
import { keys } from "#/lib/keys";
import { PAD_SETTLE_MS } from "#/lib/pad";
import { PERSIST_GC_TIME_MS } from "#/lib/persist";

/**
 * What can be asked of a zone. Colour carries brightness, as the API does.
 *
 * `rename` is the odd one: the other four move light, and this one moves a
 * label. It rides the same union anyway because it is the same zone, addressed
 * the same way, invalidating the same screens — and because keeping it separate
 * would mean a second mutation hook whose only difference from this one is that
 * it does not need the hold.
 */
export type IclChange =
	| { kind: "power"; zoneId: number; on: boolean }
	| { kind: "color"; zoneId: number; colorId: number; dim: number }
	| { kind: "brightness"; zoneId: number; dim: number }
	| { kind: "custom"; zoneId: number; rgbw: [number, number, number, number] }
	| { kind: "rename"; zoneId: number; name: string };

/** Poll cadence: the panel is the source of truth, we just mirror it. */
const POLL_MS = 10_000;

/**
 * How old data may grow before the header chip stops saying "Live". Well past
 * the poll cycle, because the chip going stale should mean polls are actually
 * failing — not that one is due, and not that they are sitting out a light
 * hold on purpose.
 */
export const STALE_MS = 30_000;

/**
 * How long a light change holds: its target state stays pinned, and the
 * panel polls go quiet.
 *
 * The quiet is not politeness. The panel serialises commands over RS-485 and
 * reports transient state for the whole pad while it works one — a poll
 * during a light's pulse sequence comes back with everything else whacked
 * too, so mid-hold answers are not usable, for this light or for anything.
 * Which is also why the window cannot confirm and end early: the API never
 * exposes a WaterColors fixture's colour (only its relay), and an echo read
 * mid-sequence proves nothing. The window is the whole answer — the official
 * app's progress bar is the same trick.
 *
 * Lights are the one thing that needs this. Everything else reports its new
 * state by the next poll, so those mutations resolve when their call returns
 * and quiet nothing.
 *
 * This window covers ICL changes; WaterColors rides waterColorsHold below —
 * for an effect pick, and for switching on, which programs Alpine White.
 */
const LIGHT_HOLD_MS = 15_000;

/** Pump speeds are near-static, so they ride a much slower cycle. */
const VSP_POLL_MS = POLL_MS * 2;

/** Macros are edited at the panel, so this is drift correction, not tracking. */
const ONETOUCH_POLL_MS = POLL_MS * 6;

/**
 * How often to ask a chemistry probe whether it is still there.
 *
 * Presence is wiring. It changes when someone fits or pulls a TruSense, which
 * happens perhaps once in the life of a pad and never while a phone is looking
 * at it. The health beside it can turn on its own — a probe left dry or knocked
 * out of calibration stops reading — but over hours, not seconds, and the
 * readings themselves keep arriving with the home screen at the live rate
 * regardless. So this is drift correction on the same minute-long cycle the
 * macros ride, sized so a probe pulled out of the water stops being quoted
 * within a minute rather than until the tab is reloaded, and so the extra
 * request it costs stays a rounding error against the panel's real traffic.
 */
const PHORP_POLL_MS = POLL_MS * 6;

/**
 * How often to re-read when the probe was last calibrated.
 *
 * Fifteen minutes, and it could defensibly be an hour. Calibrating a TruSense is
 * not something that happens while anyone watches a phone — it is a person
 * standing at the pad with a test kit, doing it once and then not again for a
 * season. The date it writes is measured in months by the time anybody reads it,
 * and `calibrationAge` prints it in months, so a quarter of an hour of staleness
 * cannot change a single character on screen unless the calibration happened
 * inside the last day.
 *
 * That last case is the one this interval is actually sized for, and it is
 * already covered twice over: a calibration started from this app invalidates
 * the key on the way out, and react-query refetches on mount, so anyone who
 * calibrates at the keypad and then opens their phone sees the truth. What is
 * left is a tab left open across somebody else's calibration, which is worth a
 * request every fifteen minutes and nothing like a request a minute.
 *
 * The cheapness argument runs the other way from `PHORP_POLL_MS`, too. That one
 * costs one request; this one costs two, since the dates and the in-progress
 * status come from different commands — so the slow cadence is buying back the
 * second request rather than merely being polite with the first.
 */
const PHORP_CALIB_POLL_MS = POLL_MS * 90;

const settle = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Who the cache belongs to. Empty until the session resolves, which also keeps
 * every account-scoped query disabled until there is an account to scope to.
 */
export function useUserId(): string {
	return useSession().data?.userId ?? "";
}

/** The prerender has no tab, so it has nothing that could have been refused. */
const neverRefused = () => false;

export function useSession() {
	// Subscribed to rather than read, because a refusal is a plain module flag
	// and not cache state — deliberately so, since everything the cache holds is
	// written on to IndexedDB and a refusal is the one thing that must not be.
	// See `refuseSession` for why.
	const refused = useSyncExternalStore(
		watchRefusal,
		sessionRefused,
		neverRefused,
	);
	const query = useQuery({
		queryKey: keys.session(),
		// There is nothing to fetch: the session is written here by signing in
		// and put back by the persister, so this only answers on a cold start
		// with an empty cache, where null is the truth.
		queryFn: () => loadSession(),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		// The same never-collect the other persisted queries take, and the
		// session needs it most. On the default five minutes an entry with no
		// observers is dropped, and the next read finds an empty cache — which
		// this query's own fetcher reports as no session, because reading the
		// cache is all it can do. That signs someone out with no request made
		// and nothing to see: no 401, no error, just a redirect to the login
		// screen from a tab that was sitting still.
		gcTime: PERSIST_GC_TIME_MS,
	});
	// Reported as an absent session rather than through a flag of its own, so
	// every reader — the header, the account key each query is scoped by, the
	// route guard — keeps asking the one question it already asked and behaves
	// exactly as it did when the refusal was a null written into the cache. The
	// query's own data is left alone: it is the thing being protected.
	return refused ? { ...query, data: null } : query;
}

export function useLogin() {
	const uid = useUserId();
	const qc = useQueryClient();
	return useMutation({
		// A rejected sign-in answers 401 like an expired session does, and the
		// mutation cache reads that as "signed out" — which on this page means
		// invalidating a null session, redirecting to the page already showing,
		// and never raising the toast. This is how it tells the two apart.
		meta: { signIn: true },
		mutationFn: ({ email, password }: { email: string; password: string }) =>
			login(email, password),
		onSuccess: (session) => {
			// Seed the session query with the just-created session so the
			// dashboard doesn't bounce back to /login before a refetch lands.
			qc.setQueryData(keys.session(), session);
			qc.invalidateQueries({ queryKey: keys.systems(uid) });
		},
	});
}

export function useLogout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => logout(),
		// The heat measurement is not in the cache, so qc.clear() does not reach
		// it — and a series of spa temperatures is as much the last account's as
		// any query is.
		onSuccess: () => {
			qc.clear();
			clearHeatRuns();
		},
	});
}

export function useSystems(enabled: boolean) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.systems(uid),
		queryFn: enabled && uid ? () => listSystems() : skipToken,
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: false,
		// The list page's chip reads this, same bar as the panel's.
		staleTime: STALE_MS,
		// Kept as long as the persisted copy is allowed to be, or a restore
		// would be collected on arrival for being older than the default.
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * The panel's three screens, each its own query.
 *
 * They were one call returning all three, which meant they shared a cache
 * entry — so none could be persisted without persisting the others, a failure
 * in any took down all three, and the slow-changing one polled as hard as the
 * live ones. Split, each keeps its own cadence and its own fate, and they sit
 * under one key prefix so a mutation still refreshes the panel in one line.
 */
const panelOptions = (quiet: boolean, interval: number) => ({
	refetchInterval: (quiet ? false : interval) as number | false,
	refetchIntervalInBackground: false,
	// Stale drives the header chip, and stale should mean something is wrong —
	// not that a poll is due this instant, and not that the polls are sitting
	// out a light hold on purpose. 30s absorbs a cycle plus most holds; the
	// slow screens keep double their own interval.
	staleTime: Math.max(interval * 2, STALE_MS),
	retry: (count: number, error: unknown) =>
		error instanceof AqualinkError && error.status === 401 ? false : count < 2,
});

/**
 * A pending light change, read straight off the mutation cache. The mutation
 * key names the serial and which mutation it is; the variables carry the
 * target state. While one is pending, usePanel pins that light to its target
 * over whatever the polls report — the panel lies about a light mid-change,
 * and this is the shape of the lie the official app's progress bar covers.
 */
type LightHold =
	| {
			kind: "actuate";
			vars: { device: PoolDevice; on: boolean; also?: PoolDevice };
	  }
	| { kind: "color"; vars: { name: string } }
	| { kind: "icl"; vars: IclChange };

const holdKey = (serial: string | undefined) =>
	["hold", serial ?? "-"] as const;

function usePendingHolds(serial: string | undefined): LightHold[] {
	return useMutationState({
		filters: { mutationKey: holdKey(serial), status: "pending" },
		select: (m) =>
			({
				kind: m.options.mutationKey?.[2],
				vars: m.state.variables,
			}) as LightHold,
	});
}

/** The snapshot with every pending change's target state pinned over it. */
function applyHolds(snap: PoolSnapshot, holds: LightHold[]): PoolSnapshot {
	let devices = snap.devices;
	let icl = snap.icl;
	for (const h of holds) {
		if (h.kind === "actuate") {
			// Both relays a single tap commands, or the second one reads as off
			// until a poll catches up with a command already sent.
			const names = [h.vars.device.name, h.vars.also?.name];
			devices = devices.map((d) =>
				names.includes(d.name) ? { ...d, on: h.vars.on } : d,
			);
		} else if (h.kind === "color")
			devices = devices.map((d) =>
				d.name === h.vars.name ? { ...d, on: true } : d,
			);
		else {
			const v = h.vars;
			icl = icl.map((z) =>
				z.zoneId !== v.zoneId
					? z
					: v.kind === "power"
						? { ...z, on: v.on }
						: v.kind === "color"
							? { ...z, on: true, colorId: v.colorId, dim: v.dim }
							: v.kind === "brightness"
								? { ...z, dim: v.dim }
								: // A rename touches the label and nothing else — the light was
									// not asked to do anything, so no other field may move. It is
									// pinned for the same reason the rest are: the new name
									// reaches the screen only once get_devices carries it, and a
									// title that snaps back to the old one for a round trip reads
									// as a rename that failed.
									v.kind === "rename"
									? { ...z, label: v.name }
									: { ...z, on: true, rgbw: v.rgbw },
			);
		}
	}
	return { ...snap, devices, icl };
}

/**
 * Which lights are mid-colour-change, for progress UI. Driven by the same
 * pending mutations as the pin, so a spinner keyed to this runs exactly as
 * long as the hold does. On/off holds are deliberately left out: the switch
 * already shows the toggle, and a spinner would dress a plain flip up as
 * work — only a colour working its way through the fixture earns one.
 */
export function useLightHolds(serial: string | undefined) {
	const holds = usePendingHolds(serial);
	return useMemo(() => {
		const devices = new Set<string>();
		const zones = new Set<number>();
		for (const h of holds) {
			if (h.kind === "color") devices.add(h.vars.name);
			// Switching on is programming Alpine White, so it spins the same;
			// switching off is a bare relay drop and does not.
			else if (h.kind === "actuate" && h.vars.device.kind === "light") {
				if (h.vars.on) devices.add(h.vars.device.name);
			} else if (
				h.kind === "icl" &&
				(h.vars.kind === "color" || h.vars.kind === "custom")
			)
				zones.add(h.vars.zoneId);
		}
		return { devices, zones };
	}, [holds]);
}

export function usePanel(serial: string | undefined) {
	const uid = useUserId();
	const holds = usePendingHolds(serial);
	// Poll answers during a light hold are transient for the whole pad, so the
	// polls sit the hold out. Only light holds quiet them; no other mutation
	// lives long enough to matter.
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;
	const ready = Boolean(serial) && Boolean(uid);

	// skipToken rather than `enabled`: it disables the query and removes the
	// fetcher with it, so a serial that is not there cannot be cast into one.
	// Without it these run before the session names the account and key under
	// an empty user id — every account's cache sharing one bucket.
	const home = useQuery({
		queryKey: keys.home(uid, serial ?? "-"),
		queryFn: ready && serial ? () => homeScreen(serial) : skipToken,
		...panelOptions(quiet, POLL_MS),
	});
	const devices = useQuery({
		queryKey: keys.devices(uid, serial ?? "-"),
		queryFn: ready && serial ? () => devicesScreen(serial) : skipToken,
		...panelOptions(quiet, POLL_MS),
	});
	// Macros change when someone edits them at the panel, which is never in the
	// course of using the app — and this is the one screen worth restoring from
	// storage, since it is names rather than readings.
	const onetouch = useQuery({
		queryKey: keys.onetouch(uid, serial ?? "-"),
		queryFn: ready && serial ? () => onetouchScreen(serial) : skipToken,
		...panelOptions(quiet, ONETOUCH_POLL_MS),
		// The one screen worth keeping: names rather than readings, so a restore
		// is still true. It has to outlive maxAge to survive being restored.
		gcTime: PERSIST_GC_TIME_MS,
	});
	/**
	 * The colour-light zones read on their own, which is additive and never the
	 * reason anything renders.
	 *
	 * Gated on the home screen's own answer, exactly as `useSwc` is: a pad
	 * without colour zones — which is nearly all of them, this one included —
	 * must never send this, or every such pool buys a pointless request forever.
	 *
	 * Slow, because what only this read can say is configuration: how many zones
	 * the panel counts, what they are named, and the RGBW behind a zone set to
	 * Custom Color. Those move when somebody edits them at the panel, not while
	 * anyone is watching the screen. Live zone state keeps arriving on the ten
	 * second poll inside `get_devices`, and a zone the owner changes here is
	 * refetched at once regardless of cadence — the key sits under the panel
	 * prefix, so the one invalidation every zone mutation already does reaches
	 * it.
	 *
	 * Deliberately not persisted. The macros screen is kept across reloads
	 * because it is names; this carries names *and* which colour is burning
	 * right now, and a restored zone insisting it is lit magenta is a lie the
	 * app cannot detect. The names are not worth the reading that rides with
	 * them.
	 */
	const iclInfo = useQuery({
		queryKey: keys.icl(uid, serial ?? "-"),
		queryFn:
			ready && serial && iclPresent(home.data)
				? () => iclGetInfo(serial)
				: skipToken,
		...panelOptions(quiet, ONETOUCH_POLL_MS),
	});
	/**
	 * The panel's own timed programs, read here rather than only by the page
	 * that lists them.
	 *
	 * They belong to the whole system, not to one screen. A schedule is enforced
	 * at the pad and overrules anything this app asks for, so a relay sitting
	 * inside an active window is not really a switch — and saying so on the
	 * screens that show those switches means the programs have to be in hand
	 * wherever equipment is drawn, not fetched when somebody happens to open a
	 * tab.
	 *
	 * Slow, like the macros: configuration moves when a person moves it. The two
	 * reads keep different company, though. The programs themselves ride the
	 * poll, because this app can change them and a second device can too. The
	 * id↔name table underneath does not move at all — it is how the pad is
	 * wired — so it has no interval and is kept across reloads, which is what
	 * lets a returning device name equipment before the network answers.
	 */
	const schedules = useQuery({
		queryKey: keys.schedules(uid, serial ?? "-"),
		queryFn: ready && serial ? () => getScheduleList(serial) : skipToken,
		...panelOptions(quiet, ONETOUCH_POLL_MS),
		// Persisted, so like the macros it has to outlive maxAge to come back.
		gcTime: PERSIST_GC_TIME_MS,
	});
	const scheduleDevices = useQuery({
		queryKey: keys.scheduleDevices(uid, serial ?? "-"),
		queryFn:
			ready && serial ? () => getScheduleDevices(serial, "1") : skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: (count: number, error: unknown) =>
			error instanceof AqualinkError && error.status === 401
				? false
				: count < 2,
		// Persisted, so like the macros it has to outlive maxAge to come back.
		gcTime: PERSIST_GC_TIME_MS,
	});
	/**
	 * The speeds a schedule can name, which only exist to be read through.
	 *
	 * Gated on the device table having named at least one pump, the way `useSwc`
	 * gates on the home screen's own answer: this costs a request per pump, and
	 * a panel with no variable-speed pump — most of them — must never send one.
	 * Chained rather than parallel because it cannot be asked until that table
	 * says which ids are pumps.
	 *
	 * Kept out of `isPending` deliberately, unlike the two above. A speed
	 * schedule is uncommon and a page that waits for this would hold every
	 * screen on three sequential requests for a table most pads have no use for.
	 * A row whose speed is not named yet says so and then fills in.
	 */
	const pumps = useMemo(
		() => (scheduleDevices.data ?? []).filter((d) => d.isVsp),
		[scheduleDevices.data],
	);
	const scheduleSpeeds = useQuery({
		queryKey: keys.scheduleSpeeds(uid, serial ?? "-"),
		queryFn:
			ready && serial && pumps.length
				? () => getScheduleSpeeds(serial, pumps)
				: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		gcTime: PERSIST_GC_TIME_MS,
	});

	const snapshot = useMemo(
		() =>
			home.data && devices.data
				? normalize(
						serial ?? "",
						home.data,
						devices.data.devices,
						devices.data.icl,
						onetouch.data,
						iclInfo.data,
					)
				: undefined,
		[serial, home.data, devices.data, onetouch.data, iclInfo.data],
	);
	// Pinned over what the polls report: a light mid-change reads as its
	// target until its mutation resolves, so a mid-pulse "off" never paints.
	const data =
		snapshot && holds.length ? applyHolds(snapshot, holds) : snapshot;

	return {
		data,
		schedules,
		scheduleDevices,
		scheduleSpeeds,
		// All of them, so the screen never paints half-built. Macros and the
		// schedule device table can satisfy this from storage where the readings
		// cannot — which is the point of splitting them: the cacheable ones stop
		// holding up the rest. Safe to gate on, unlike the colour zones below:
		// these are always sent when there is a serial, so they always settle,
		// where a skipToken never leaves pending at all. A panel that rejects
		// schedules settles too, as an error.
		isPending:
			home.isPending ||
			devices.isPending ||
			onetouch.isPending ||
			schedules.isPending ||
			scheduleDevices.isPending,
		// Liveness is the two live screens and nothing else. The programs are
		// configuration on a minute-long cycle, so folding them in here would
		// have the header call the pad stale for being unhurried about them.
		isFetching: home.isFetching || devices.isFetching,
		isSuccess: home.isSuccess && devices.isSuccess,
		isStale: home.isStale || devices.isStale,
		dataUpdatedAt: Math.min(home.dataUpdatedAt, devices.dataUpdatedAt),
		refetch: () => {
			home.refetch();
			devices.refetch();
			onetouch.refetch();
			schedules.refetch();
			scheduleDevices.refetch();
			scheduleSpeeds.refetch();
			// Kept out of isPending/isFetching above and only refetched here: on
			// nearly every pad this query is a skipToken, which never leaves the
			// pending state — folding it into those would hold the whole screen on
			// a request that is never going to be sent.
			iclInfo.refetch();
		},
	};
}

type DevicesScreen = { devices: Raw; icl: unknown };

/**
 * Optimistic writes for the panel mutations.
 *
 * The cache holds the three screens as the API sent them — normalize() runs at
 * render, not at fetch — so an optimistic update has to speak the wire format:
 * flip the raw state, and the same parser that reads the panel reads the flip.
 * (These updates used to write a normalized snapshot to the combined panel
 * key, which stopped being a real cache entry when the panel split into three
 * queries — every switch sent its command and then sat unmoved until the next
 * poll, reading as dead.)
 */
function usePanelCache(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const s = serial ?? "-";
	const qk = keys.panel(uid, s);
	const hk = keys.home(uid, s);
	const dk = keys.devices(uid, s);
	const ok = keys.onetouch(uid, s);
	const ik = keys.icl(uid, s);

	// A raw entry is `{ state: "0", ... }` or a bare scalar that is the state.
	const withState = (v: unknown, state: string): unknown =>
		v && typeof v === "object" && !Array.isArray(v)
			? { ...(v as Raw), state }
			: state;

	/** The snapshot the screens are rendering, composed from the raw cache. */
	const read = (): PoolSnapshot | undefined => {
		const home = qc.getQueryData<Raw>(hk);
		const devices = qc.getQueryData<DevicesScreen>(dk);
		return home && devices
			? normalize(
					s,
					home,
					devices.devices,
					devices.icl,
					qc.getQueryData(ok),
					// So a snapshot composed from the cache holds the same zones the
					// screen is showing. Undefined on every pad without the read, which
					// is what normalize() already expects.
					qc.getQueryData(ik),
				)
			: undefined;
	};

	return {
		read,
		cancel: () => qc.cancelQueries({ queryKey: qk }),
		invalidate: () => qc.invalidateQueries({ queryKey: qk }),
		snapshot: () => ({
			home: qc.getQueryData<Raw>(hk),
			devices: qc.getQueryData<DevicesScreen>(dk),
			onetouch: qc.getQueryData(ok),
		}),
		// setQueryData ignores undefined, which is right here: a screen that
		// held nothing was never patched, so there is nothing to put back.
		restore: (prev: {
			home: Raw | undefined;
			devices: DevicesScreen | undefined;
			onetouch: unknown;
		}) => {
			qc.setQueryData(hk, prev.home);
			qc.setQueryData(dk, prev.devices);
			qc.setQueryData(ok, prev.onetouch);
		},
		/** Set one device's raw state on whichever screen(s) report it. */
		setDeviceState: (name: string, state: string) => {
			qc.setQueryData(hk, (old: Raw | undefined) =>
				old && name in old
					? { ...old, [name]: withState(old[name], state) }
					: old,
			);
			qc.setQueryData(dk, (old: DevicesScreen | undefined) =>
				old && name in old.devices
					? {
							...old,
							devices: {
								...old.devices,
								[name]: withState(old.devices[name], state),
							},
						}
					: old,
			);
		},
		/**
		 * Patch raw fields on one device, rather than only its state.
		 *
		 * `setDeviceState` covers everything whose whole change is the state field,
		 * which until dimmers was everything. A level change moves two fields at
		 * once — `subtype` carries the level and `state` says whether the relay is
		 * closed — and writing either alone would leave the row disagreeing with
		 * itself for a poll: bright and off, or on at nothing.
		 *
		 * A bare scalar entry becomes an object here, where `withState` would keep
		 * it a scalar. That is the only shape a patch of named fields can take, and
		 * normalize() reads both forms.
		 */
		setDeviceFields: (name: string, patch: Raw) => {
			const merge = (v: unknown): Raw =>
				v && typeof v === "object" && !Array.isArray(v)
					? { ...(v as Raw), ...patch }
					: { ...patch };
			qc.setQueryData(hk, (old: Raw | undefined) =>
				old && name in old ? { ...old, [name]: merge(old[name]) } : old,
			);
			qc.setQueryData(dk, (old: DevicesScreen | undefined) =>
				old && name in old.devices
					? {
							...old,
							devices: { ...old.devices, [name]: merge(old.devices[name]) },
						}
					: old,
			);
		},
		patchHeatPump: (patch: { on?: boolean; mode?: string }) => {
			qc.setQueryData(hk, (old: Raw | undefined) => {
				const hp = old?.heatpump_info;
				if (!hp || typeof hp !== "object" || Array.isArray(hp)) return old;
				// The two casings get_home and the command echoes disagree on.
				const cased = "isHPMPresent" in hp;
				const next = { ...(hp as Raw) };
				if (patch.on !== undefined)
					next[cased ? "HPMstatus" : "heatpumpstatus"] = patch.on
						? "on"
						: "off";
				if (patch.mode !== undefined)
					next[cased ? "HPMmode" : "heatpumpmode"] = patch.mode;
				return { ...old, heatpump_info: next };
			});
		},
		/** Flip `name`, stopping the rest: the panel runs one macro at a time. */
		toggleMacro: (name: string) => {
			const running = read()?.macros.find((m) => m.name === name)?.on;
			qc.setQueryData(ok, (old: unknown) => {
				if (!Array.isArray(old)) return old;
				return old.map((row) => {
					if (!row || typeof row !== "object") return row;
					const out: Raw = {};
					for (const [key, parts] of Object.entries(row as Raw)) {
						out[key] =
							key.startsWith("onetouch_") && Array.isArray(parts)
								? parts.map((p: unknown) =>
										p && typeof p === "object" && "state" in p
											? {
													...(p as Raw),
													state: key === name && !running ? "1" : "0",
												}
											: p,
									)
								: parts;
					}
					return out;
				});
			});
		},
	};
}

/**
 * Actuate a device. No cache surgery: while this is pending, usePanel pins
 * the device to its target state over whatever the polls report, and the
 * pending state outlives the refetch below — so the pin hands off to fresh
 * data with no frame of stale state in between. An error just drops the pin.
 */
export function useActuate(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const panel = usePanelCache(serial);
	return useMutation({
		mutationKey: [...holdKey(serial), "actuate"],
		mutationFn: async ({
			device,
			on,
			also,
			resumeSpeed,
		}: {
			device: PoolDevice;
			on: boolean;
			/**
			 * A second relay to close straight after this one, inside the same
			 * mutation. Chaining two mutations instead put the whole settle and
			 * refetch cascade between the commands — seconds of it — so the spa
			 * heater lagged the valves badly enough to look broken.
			 */
			also?: PoolDevice;
			/**
			 * Whether closing a relay that carries a variable-speed pump should
			 * also send that pump a speed.
			 *
			 * Off by default, because the extra command belongs to a surface
			 * rather than to the act: the hero's switches mean "run this", and
			 * the equipment page's mean exactly the command they are named
			 * after. The panel restores no speed on its own either way.
			 */
			resumeSpeed?: boolean;
		}) => {
			const flip = (d: PoolDevice, state: boolean) =>
				toggleDevice(
					serial as string,
					d.name,
					d.kind,
					state,
					typeof d.raw.subtype === "string" ? d.raw.subtype : "",
				);
			const res = await flip(device, on);
			// One after the other rather than at once: the pad works a single
			// RS-485 command at a time either way, and sending the second only
			// once the first is answered keeps them in the order asked for.
			if (also) await flip(also, on);
			// The relay, then — once the panel has answered — the speed, because
			// the panel restores none on its own. The user's last known speed
			// wins, then whatever the table calls active, then the first
			// configured speed as the default.
			if (on && resumeSpeed) {
				const pump = pumpForDevice(
					qc.getQueryData<VspPump[]>(keys.vsp(uid, serial ?? "-")),
					device.name,
				);
				if (pump) {
					const last = serial && lastPumpSpeed(serial, pump.pumpId);
					const speedId =
						pump.speeds.find((s) => s.id === last)?.id ??
						pump.speeds.find((s) => s.active)?.id ??
						pump.speeds[0]?.id;
					if (speedId !== undefined)
						await setVspSpeed(serial as string, speedId, pump.pumpId);
				}
			}
			// Switching a WaterColors light on IS programming Alpine White: the
			// fixture comes up at the head of its table, so it rides the same
			// hold as picking id 1. Off is a bare relay drop — but the release
			// refetch still has to outwait the pad's transient window, or it
			// reads back a snapshot with the readings blanked.
			if (device.kind === "light")
				await settle(on ? waterColorsHold(1) : PAD_SETTLE_MS);
			return res;
		},
		onMutate: async ({ device, on }): Promise<{ vspPrev?: VspPump[] }> => {
			// A poll already in flight when a light's hold starts would land
			// mid-pulse with the whole pad reading wrong; cancelled, not landed.
			if (device.kind === "light" && on) {
				await panel.cancel();
				return {};
			}
			// Opening a pump's relay stops the pump, but the vsp screen keeps
			// reporting the active speed until its slower cycle notices — clear
			// running now, or the switch reads on well after the tap.
			if (!on) {
				const vspKey = keys.vsp(uid, serial ?? "-");
				const pumps = qc.getQueryData<VspPump[]>(vspKey);
				const pump = pumpForDevice(pumps, device.name);
				if (pump) {
					qc.setQueryData(
						vspKey,
						pumps?.map((p) =>
							p.pumpId === pump.pumpId ? { ...p, running: false } : p,
						),
					);
					return { vspPrev: pumps };
				}
			}
			return {};
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.vspPrev)
				qc.setQueryData(keys.vsp(uid, serial ?? "-"), ctx.vspPrev);
		},
		// The pumps too: a relay carrying a variable-speed pump reports its
		// speed on a separate query with a slower cycle, and leaving that behind
		// left one button reading its fill from the snapshot and its selection
		// from data up to a cycle older.
		onSettled: async (_res, _err, { device, on }) => {
			const vspKey = keys.vsp(uid, serial ?? "-");
			// Lights release only onto data that agrees with the flip, as the
			// colour mutation does — a refetch reading the relay mid-transition
			// would paint the opposite state for a whole poll cycle.
			if (device.kind === "light") {
				for (let i = 0; ; i++) {
					await panel.invalidate();
					const lit = panel
						.read()
						?.devices.find((d) => d.name === device.name)?.on;
					if (lit === on || lit === undefined || i >= 3) break;
					await settle(2_000);
				}
				await qc.invalidateQueries({ queryKey: vspKey });
				return;
			}
			await panel.invalidate();
			// A stopped pump can keep reporting its speed for a beat, and
			// releasing onto that would flip the switch back on — so the vsp
			// refetch retries until the screen agrees the pump stopped.
			const pump = pumpForDevice(
				qc.getQueryData<VspPump[]>(vspKey),
				device.name,
			);
			for (let i = 0; ; i++) {
				await qc.invalidateQueries({ queryKey: vspKey });
				const still =
					!on &&
					pump &&
					qc
						.getQueryData<VspPump[]>(vspKey)
						?.find((p) => p.pumpId === pump.pumpId)?.running;
				if (!still || i >= 3) break;
				await settle(2_000);
			}
		},
	});
}

/**
 * Adjust one set point. Which command carries it depends on the equipment: a
 * paired heat pump supersedes the relay heaters, so it takes the set points
 * with it, and pool chill only ever existed on that path. The difference is
 * not cosmetic — set_temps needs both values seeded, while setpoint_hpm_temp
 * takes only the one that changed.
 */
export function useSetPoint(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationFn: async ({ name, value }: { name: string; value: number }) => {
			const snap = panel.read();
			const param = HPM_TEMP_PARAM[name];
			const viaHpm = name === "pool_chill_set_point" || Boolean(snap?.heatPump);

			let res: unknown;
			if (viaHpm && param) {
				res = await setHpmSetPoint(serial as string, {
					[param]: String(value),
				});
			} else {
				// set_temps carries both bodies, so the untouched one is read back
				// out of the cache rather than left blank, which would clear it.
				const at = (n: string) =>
					snap?.devices.find((d) => d.name === n)?.value ?? "";
				res = await setTemps(
					serial as string,
					name === "spa_set_point" ? String(value) : at("spa_set_point"),
					name === "pool_set_point" ? String(value) : at("pool_set_point"),
				);
			}
			return res;
		},
		onMutate: async ({ name, value }) => {
			await panel.cancel();
			const prev = panel.snapshot();
			// A set point's shown value reads from the same raw state field.
			panel.setDeviceState(name, String(value));
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
		onSettled: () => panel.invalidate(),
	});
}

/**
 * Set a dimming relay's brightness.
 *
 * Modelled on the set point rather than on the lights, and the difference is the
 * point. A colour light holds because it is pulse-programmed: the panel cuts
 * power and counts pulses at the fixture, reports transient state for the whole
 * pad while it does, and never reports the resulting colour — so the hold window
 * is the only answer available. A dimming relay is none of that. It is a level
 * output the panel drives directly, it reports what it did, and this app's own
 * ICL code already draws the same line for the same reason: brightness applies
 * at once and needs no wait at all. So there is no hold key here on purpose —
 * that key stops the polls for the entire pad, which a level change has no claim
 * to — and no settle either.
 *
 * If a poll ever turns out to echo a transient level, the fix is a
 * `settle(PAD_SETTLE_MS)` inside the mutationFn, never a hold.
 *
 * Unverified end to end: no dimming relay has ever answered this app. The
 * optimistic write mirrors the read in normalize(), so if the panel reports the
 * level somewhere other than `subtype`, the row will snap back on the next poll
 * rather than lie — which is the failure worth having.
 */
export function useSetDimmer(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationFn: ({ device, level }: { device: PoolDevice; level: number }) =>
			setDimmerLevel(serial as string, device.name, level),
		onMutate: async ({ device, level }) => {
			await panel.cancel();
			const prev = panel.snapshot();
			// Both halves of the change, since 0 is off rather than dim: the level
			// rides `subtype`, which is where normalize() reads it back out.
			panel.setDeviceFields(device.name, {
				state: level > 0 ? "1" : "0",
				subtype: String(level),
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
		onSettled: () => panel.invalidate(),
	});
}

/**
 * Run a OneTouch macro. The command toggles rather than sets, and the panel
 * reports one macro at a time as the active configuration — so starting one
 * ends whichever was running.
 */
export function useOneTouch(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationFn: (name: string) => setOnetouch(serial as string, name),
		onMutate: async (name) => {
			await panel.cancel();
			const prev = panel.snapshot();
			panel.toggleMacro(name);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
		onSettled: () => panel.invalidate(),
	});
}

/** Enable the heat pump, or switch it between heating and chilling. */
export function useHeatPump(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationFn: (
			v: { kind: "power"; on: boolean } | { kind: "mode"; mode: string },
		) =>
			v.kind === "power"
				? enableHpm(serial as string, v.on)
				: switchHpmMode(serial as string, v.mode),
		onMutate: async (v) => {
			await panel.cancel();
			const prev = panel.snapshot();
			panel.patchHeatPump(v.kind === "power" ? { on: v.on } : { mode: v.mode });
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
		onSettled: () => panel.invalidate(),
	});
}

/**
 * The salt chlorinator's configuration: a fourth panel screen, and the only
 * one that is conditional.
 *
 * `present` is the home screen's answer, and it gates the fetch rather than the
 * render — most panels have no cell, and an unconditional query would buy every
 * one of them a rejected request per cycle forever. It also rides the slow
 * cadence: output percent and boost hours move when a person moves them, so
 * polling this at the live rate would only ever find its own last write.
 *
 * The command is unverified against real hardware, so a panel that does not
 * know it simply leaves this in error and no control renders — which is why the
 * card upstream takes its status from get_home instead of from here.
 */
export function useSwc(serial: string | undefined, present: boolean) {
	const uid = useUserId();
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;
	return useQuery({
		queryKey: keys.swc(uid, serial ?? "-"),
		queryFn: uid && serial && present ? () => getSwcConfig(serial) : skipToken,
		...panelOptions(quiet, ONETOUCH_POLL_MS),
	});
}

/**
 * The chemistry probe's report on itself, gated the way the chlorinator is.
 *
 * `reported` should be true only when `get_home` has already put a number on
 * one of the two chemistry keys, and that gate is the whole design. Most pads
 * have no TruSense, and an unconditional query would buy every one of them a
 * pointless request a minute for as long as the app is open — the same bargain
 * useSwc refuses. It also means the request is only ever spent on the case it
 * can settle: a number that might be a probe's measurement and might be a
 * placeholder. Where `get_home` says nothing there is nothing on screen to
 * correct, so there is nothing worth asking about.
 *
 * The cost of that gate, stated plainly: a probe that is fitted but sends
 * nothing to the home screen is never asked about, and the app stays as silent
 * about it as it is today. Saying nothing about a probe that says nothing is
 * not a lie, and it is the half of the ambiguity that costs nothing to leave
 * alone.
 *
 * An error here is not a failure worth surfacing. It means the panel does not
 * know the command, or wants a unit id nobody has documented — in either case
 * the channels stay `unknown` and the readings render exactly as they did
 * before this existed.
 */
export function usePhOrp(serial: string | undefined, reported: boolean) {
	const uid = useUserId();
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;
	return useQuery({
		queryKey: keys.phorp(uid, serial ?? "-"),
		queryFn: uid && serial && reported ? () => readPhOrp(serial) : skipToken,
		...panelOptions(quiet, PHORP_POLL_MS),
	});
}

/**
 * When the probe was last calibrated, gated one step tighter than the probe read
 * above.
 *
 * `fitted` should be true only where `usePhOrp` has already come back and named
 * a channel present. That is a strictly narrower gate than `usePhOrp`'s own, and
 * the extra narrowness is the point: `reported` lets through a panel that put a
 * number on the home screen and then turned out to have no probe behind it,
 * which is exactly this pool, and asking such a panel when its absent sensor was
 * last calibrated is two requests a cycle spent on a question with no subject.
 * An `unknown` presence — the request failed, or the panel does not know the
 * command — is also not enough, because everything downstream of it is a
 * calibration control, and a control over hardware nobody has confirmed exists
 * should not be drawn.
 *
 * Deliberately not persisted, and it is the one query where that needed
 * thinking. Two of its four facts would survive a reload honestly: a calibration
 * date is configuration in the same way a macro name is, and it is true for
 * months. The third is not — `status` reports a calibration happening right now,
 * and a restore insisting one is under way would disable the controls on a pad
 * where nothing is happening, or worse, clear on a pad where something is. So
 * this lands where the zones did: the durable half is not worth the live half
 * riding in with it, and neither is worth a `PERSISTED` entry when the whole
 * thing refetches on mount anyway.
 *
 * An error is not surfaced. It means the panel does not know these commands, or
 * wants a unit id nobody has documented, and in either case no calibration
 * control renders and the page is exactly what it was.
 */
export function usePhOrpCalibration(
	serial: string | undefined,
	fitted: boolean,
) {
	const uid = useUserId();
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;
	return useQuery({
		queryKey: keys.phorpCalib(uid, serial ?? "-"),
		queryFn:
			uid && serial && fitted ? () => readPhOrpCalibration(serial) : skipToken,
		...panelOptions(quiet, PHORP_CALIB_POLL_MS),
	});
}

/**
 * Calibrate a channel. The only mutation in this app that changes hardware
 * rather than what hardware is doing.
 *
 * Everything else here is a relay, a set point or a name: send it wrong and the
 * next tap sends it right. A calibration rewrites the reference a sensor
 * measures against, so getting it wrong does not break anything visibly — it
 * leaves the probe reporting numbers with the same confidence as before, about a
 * pool it is now wrong about, until somebody notices the water disagreeing with
 * a test kit and does the procedure again. That is why the surface is a
 * confirmation dialog rather than a switch, and why this hook makes no
 * optimistic write: the panel's own answer is the only thing that knows whether
 * a calibration happened, and painting "calibrated today" before it agrees would
 * be the exact species of lie the whole chemistry read exists to stop.
 *
 * The unit id comes out of the cached read and nowhere else. Without one there
 * is no write at all — see `PhOrpCalibration.unitId` for why an invented id is
 * not an option on a command that rewrites a physical sensor. The same refusal
 * `useSwcOutput` makes when it has no set point to carry alongside, for a
 * consequence a good deal harder to undo.
 *
 * Two-point pH is missing on purpose, and its absence is the considered outcome
 * rather than a gap. The physical procedure is documented well enough — Jandy's
 * manual has the operator soak the sensor in pH 7 buffer, start the calibration,
 * then swap to pH 4 buffer and start it again, and is explicit that pH 10 is not
 * used. What is not documented anywhere is the wire half: `do_2point_phcalibration`
 * carries a `step_no` and no source says how many values it takes, whether it
 * counts from 0 or 1, what the panel answers while it waits between them, or how
 * an abandoned sequence is cleared. Two operator actions imply two steps, and
 * that is an inference, not a capture.
 *
 * The failure that inference buys is specific and bad. The two steps are not
 * interchangeable: one of them tells the probe "what you are sitting in is pH 7"
 * and the other says "pH 4". Guess the numbering backwards and the app confidently
 * walks somebody through calibrating a sensor with its two references swapped,
 * which is a worse-than-uncalibrated probe reached by following instructions.
 * Half-finishing it — the buffer runs out, the phone locks, the panel goes offline
 * between steps — leaves the probe in a state nothing here can describe or undo.
 *
 * One-point pH and ORP are single commands with no sequence to get wrong, which
 * is the entire reason they are here and it is not.
 */
export function useCalibrate(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.phorpCalib(uid, serial ?? "-");
	return useMutation({
		mutationFn: (v: { kind: "ph"; phValue: number } | { kind: "orp" }) => {
			const current = qc.getQueryData<PhOrpCalibration>(qk);
			if (!current)
				throw new AqualinkError("Probe calibration state not loaded yet");
			return v.kind === "ph"
				? calibratePh1Point(serial as string, current.unitId, v.phValue)
				: calibrateOrp(serial as string, current.unitId);
		},
		// Both reads again, since a calibration is precisely what moves them, and
		// the status field is the only way to see one still running.
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/**
 * Set one body's chlorine output.
 *
 * `set_swc_config` carries both set points on every write, so the untouched one
 * is read back out of the cache first — the same trap set_temps has, and a
 * worse one to fall into: a blank there does not leave the spa alone, it stops
 * the cell producing for it. Without a cached config there is nothing honest to
 * send for the other body, so the write does not happen at all.
 *
 * No hold and no settle. Those exist for lights, which the panel pulses over
 * RS-485 while misreporting the whole pad; this is a number the panel stores.
 * It needs no optimistic guess either — the command echoes the entire
 * configuration back, so the panel's own answer seeds the cache.
 */
export function useSwcOutput(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.swc(uid, serial ?? "-");
	return useMutation({
		mutationFn: ({ body, value }: { body: "pool" | "spa"; value: number }) => {
			const current = qc.getQueryData<SwcConfig>(qk);
			if (!current)
				throw new AqualinkError("Chlorinator settings not loaded yet");
			return setSwcOutput(
				serial as string,
				body === "pool" ? value : current.poolSetPoint,
				body === "spa" ? value : current.spaSetPoint,
			);
		},
		onMutate: async ({ body, value }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData<SwcConfig>(qk);
			qc.setQueryData(
				qk,
				(old: SwcConfig | undefined) =>
					old && {
						...old,
						[body === "pool" ? "poolSetPoint" : "spaSetPoint"]: value,
					},
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		// Only when the echo actually parsed as a configuration: a shape this app
		// does not recognise leaves the optimistic value standing rather than
		// replacing it with zeroes read out of a body that held none.
		onSuccess: (config) => {
			if (config) qc.setQueryData(qk, config);
		},
		// Only the home screen: the echo already carried the configuration, so
		// re-reading it would be asking a question just answered — but what the
		// cell is currently producing lives in get_home's swc_info, which the
		// write does not touch.
		onSettled: () =>
			qc.invalidateQueries({ queryKey: keys.home(uid, serial ?? "-") }),
	});
}

/**
 * Start, stop, pause or resume a boost — the cell's superchlorinate cycle,
 * which is a day at full production rather than a setting. Worth knowing
 * before offering it: Jandy's manual says boost overrides schedules, ALL OFF,
 * and manual operation of the filter pump, so starting one starts the pump.
 *
 * Only a start carries the hours and the circuit; the other three verbs act on
 * a cycle that already named both, so sending them again could only disagree
 * with it.
 */
export function useSwcBoost(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.swc(uid, serial ?? "-");
	return useMutation({
		mutationFn: (control: SwcBoostControl) => {
			if (control !== "start")
				return controlSwcBoost(serial as string, control);
			const current = qc.getQueryData<SwcConfig>(qk);
			return controlSwcBoost(
				serial as string,
				"start",
				// The panel's own configured duration wins; the AquaPure default is
				// the fallback, so a panel reporting none still gets a whole cycle.
				current?.boostHours || SWC_BOOST_HOURS,
				// Only where the panel has a mode to choose at all — see
				// boostModeAvailable. Elsewhere the parameter is left off entirely
				// rather than asserted, and the panel boosts the way it is wired.
				current?.boostModeAvailable ? current.boostMode : undefined,
			);
		},
		onSuccess: (config) => {
			if (config) qc.setQueryData(qk, config);
		},
		// As above: the countdown came back in the echo, but the cell's status on
		// the home screen changes with it and has to be re-read.
		onSettled: () =>
			qc.invalidateQueries({ queryKey: keys.home(uid, serial ?? "-") }),
	});
}

/**
 * How long a WaterColors effect change holds: a reset, then one pulse per
 * step past the first colour.
 *
 * Watched at the pool: the light goes dark for 8–10 seconds — the panel
 * holding power off until the fixture falls back to the head of its table —
 * and only then starts pulsing, one step per pulse. The reset lands ON the
 * first colour, so Alpine White (id 1) needs no pulses at all and the count
 * is id − 1. The panel does all this blind every time, since neither it nor
 * the API ever knows what colour is running — which is why the duration
 * depends only on the target. 6s base, then 0.6s per id — the pulse cadence
 * AqualinkD uses when it programs these fixtures itself. The base is settled
 * by trial: a shorter one released the refetch into the pad's transient
 * window and the switch flickered at the handoff.
 */
const WATERCOLORS_RESET_MS = 6_000;
const WATERCOLORS_STEP_MS = 600;
const waterColorsHold = (effectId: number) =>
	WATERCOLORS_RESET_MS + WATERCOLORS_STEP_MS * effectId;

/**
 * Set a light's color effect. Effect ids start at 1 and 0 is "off", so
 * choosing one turns the light on — the pin shows it on throughout the hold.
 */
export function useLightColor(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationKey: [...holdKey(serial), "color"],
		mutationFn: async ({
			name,
			subtype,
			effectId,
		}: {
			name: string;
			subtype: string;
			effectId: number;
		}) => {
			const res = await setLightColor(
				serial as string,
				name,
				subtype,
				effectId,
			);
			await settle(waterColorsHold(effectId));
			return res;
		},
		// As in useActuate: an in-flight poll would land mid-pulse. And the
		// pick is remembered here, because the panel cannot: this light's
		// colour is never reported, so the memory IS the resume state.
		onMutate: ({ name, effectId }) => {
			if (serial) remember(lastLightKey(serial), name, effectId);
			return panel.cancel();
		},
		// The hold can run out a pulse or two early, and a refetch then reads
		// the tail of the sequence — the relay mid-pulse, "off" — which would
		// paint the light off for a whole poll cycle. So the refetch retries
		// until the light reads on, briefly; the mutation is still pending
		// through this, so the pin and the spinner hold to the handoff.
		onSettled: async (_res, _err, { name }) => {
			for (let i = 0; ; i++) {
				await panel.invalidate();
				const lit = panel.read()?.devices.find((d) => d.name === name)?.on;
				if (lit || i >= 3) return;
				await settle(2_000);
			}
		},
	});
}

/**
 * The panel forgets a pump's speed the moment the pump turns off: the next
 * poll reports no active speed at all. We remember — per system, per pump,
 * in localStorage — so the speed grid keeps the last selection dimmed while
 * the pump is off, and the hero's switch has a speed to resume. The official
 * app cannot do this; the panel is its only memory.
 */
const lastSpeedKey = (serial: string) => `pool-link:vsp-last:${serial}`;
const lastLightKey = (serial: string) => `pool-link:light-last:${serial}`;

const readMemory = (key: string): Record<string, number> => {
	try {
		return JSON.parse(localStorage.getItem(key) ?? "{}");
	} catch {
		return {};
	}
};

const remember = (key: string, field: string | number, value: number) => {
	try {
		localStorage.setItem(
			key,
			JSON.stringify({ ...readMemory(key), [field]: value }),
		);
	} catch {
		// Private browsing or no storage; the panel's reporting is the floor.
	}
};

const rememberSpeed = (serial: string, pumpId: number, speedId: number) =>
	remember(lastSpeedKey(serial), pumpId, speedId);

/**
 * The user's last speed for a pump, straight from memory. The hero resumes
 * from this rather than from the `active` flags in the data, which a refetch
 * race can blank or a poll re-teach at exactly the wrong moment.
 */
export const lastPumpSpeed = (
	serial: string,
	pumpId: number,
): number | undefined => readMemory(lastSpeedKey(serial))[pumpId];

/**
 * The last effect picked for a WaterColors light. Stronger than the pump
 * memory in one way: the panel never reports this light's colour at all, so
 * this is not a cache of the panel's knowledge — it is the only knowledge.
 */
export const lastLightEffect = (
	serial: string,
	deviceName: string,
): number | undefined => readMemory(lastLightKey(serial))[deviceName];

/**
 * Teach the light memory from outside a colour mutation — the plain relay-on
 * lands the fixture on Alpine White without any set_light being sent, and
 * that is knowledge worth keeping too.
 */
export const rememberLightEffect = (
	serial: string,
	deviceName: string,
	effectId: number,
): void => remember(lastLightKey(serial), deviceName, effectId);

const lastTempKey = (serial: string) => `pool-link:temp-last:${serial}`;

/**
 * Past this a remembered reading is thrown away rather than shown, and the
 * hero goes back to a dash, which claims nothing at all.
 *
 * The two bodies keep their heat on completely different terms. A pool is tens
 * of thousands of gallons with a day's thermal inertia, so a reading taken
 * this morning still describes the afternoon. A spa is a few hundred gallons
 * over a large surface, and off the heater it drops fast enough that half an
 * hour is already a different temperature — so its number is discarded at the
 * same age the other memories would start apologising for one.
 *
 * That alignment is deliberate: TEMP_STALE_MS is also half an hour, so a spa
 * reading is either fresh enough to stand on its own or gone. It never appears
 * wearing an age, because a spa temperature old enough to need dating is not
 * worth showing at all. The pool keeps that middle state, where a reading from
 * a few hours ago is still worth having as long as it says so.
 */
const TEMP_MEMORY_MAX_AGE_MS: Record<string, number> = {
	pool_temp: 6 * 60 * 60_000,
	spa_temp: 30 * 60_000,
};

/**
 * Past this the reading has to admit its age. Inside half an hour the water
 * has barely moved and the number is as good as live; past it, showing a
 * temperature without saying when it was taken is the one thing persist.ts
 * refuses to do — "a restored reading would be a lie the app cannot detect".
 * Detected and declared, it is not a lie.
 */
export const TEMP_STALE_MS = 30 * 60_000;

/** A reading the panel gave us once, and when. */
export interface RememberedTemp {
	value: string;
	at: number;
}

/**
 * The panel reports a temperature only for the body that is circulating, so
 * flipping to the spa blanks the pool and leaves the hero with a dash where a
 * number was. The last one each body gave stands in until it goes stale.
 */
export function rememberTemp(serial: string, body: string, value: string) {
	try {
		const all = JSON.parse(
			localStorage.getItem(lastTempKey(serial)) ?? "{}",
		) as Record<string, RememberedTemp>;
		localStorage.setItem(
			lastTempKey(serial),
			JSON.stringify({ ...all, [body]: { value, at: Date.now() } }),
		);
	} catch {
		// No storage; the hero falls back to a dash, as it did before.
	}
}

export function lastTemp(serial: string, body: string): RememberedTemp | null {
	try {
		const one = (
			JSON.parse(localStorage.getItem(lastTempKey(serial)) ?? "{}") as Record<
				string,
				RememberedTemp
			>
		)[body];
		if (typeof one?.value !== "string" || typeof one?.at !== "number")
			return null;
		const maxAge =
			TEMP_MEMORY_MAX_AGE_MS[body] ?? TEMP_MEMORY_MAX_AGE_MS.spa_temp;
		return Date.now() - one.at > maxAge ? null : one;
	} catch {
		return null;
	}
}

/**
 * Fetched pumps, with forgotten speeds restored from local memory. A pump
 * that reports a speed teaches the memory; one that reports none — off, in
 * the panel's telling — reads its last known speed back instead of blanking
 * the selection.
 */
const withRememberedSpeeds = (serial: string, pumps: VspPump[]): VspPump[] =>
	pumps.map((pump) => {
		const active = pump.speeds.find((s) => s.active);
		if (active) {
			rememberSpeed(serial, pump.pumpId, active.id);
			return pump;
		}
		// The last known speed, or failing that the first configured one — the
		// same default a turn-on would send — so the dimmed selection always
		// previews exactly what "on" will do.
		const last = readMemory(lastSpeedKey(serial))[pump.pumpId];
		const mark = pump.speeds.find((s) => s.id === last) ?? pump.speeds[0];
		if (!mark) return pump;
		return {
			...pump,
			speeds: pump.speeds.map((s) => ({ ...s, active: s.id === mark.id })),
		};
	});

/**
 * Variable-speed pumps and their configured speeds.
 *
 * Building this costs two requests plus one per installed pump, so it is polled
 * far more slowly than a snapshot. Speeds only change when someone changes them,
 * and the mutation below invalidates this — the poll is just drift correction.
 */
export function useVspPumps(serial: string | undefined) {
	const uid = useUserId();
	// Quiet during light holds, same as the panel: its answers ride the same
	// RS-485 line and come back just as transient.
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;

	return useQuery({
		queryKey: keys.vsp(uid, serial ?? "-"),
		queryFn:
			uid && serial
				? async () => withRememberedSpeeds(serial, await listVspPumps(serial))
				: skipToken,
		refetchInterval: quiet ? false : VSP_POLL_MS,
		refetchIntervalInBackground: false,
		staleTime: VSP_POLL_MS * 2,
		// As above: this is the one worth restoring, so it has to survive to be
		// restored. Pump wiring does not change on its own in the meantime.
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * Run a pump at one of its speeds. The command carries `on_off_action: "on"`,
 * so picking a speed starts the pump if it was stopped — the same way choosing
 * a light colour turns the light on.
 */
export function useSetVspSpeed(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const panel = usePanelCache(serial);
	const qk = keys.vsp(uid, serial ?? "-");
	return useMutation({
		mutationFn: async ({
			pumpId,
			speedId,
			closeRelay,
		}: {
			pumpId: number;
			speedId: number;
			/**
			 * Whether a speed on a stopped pump should close its relay first.
			 *
			 * Speed alone starts the pump with the relay left open, and an open
			 * relay is a switch reading off over running water. Correcting that
			 * is ours, not the panel's — so the hero, which is about the water,
			 * asks for it, and the equipment page, which mirrors what the
			 * official app sends, does not.
			 */
			closeRelay?: boolean;
		}) => {
			const pump = closeRelay
				? qc.getQueryData<VspPump[]>(qk)?.find((p) => p.pumpId === pumpId)
				: undefined;
			const relay = panel
				.read()
				?.devices.find(
					(d) => pump?.auxes.some((n) => d.name === `aux_${n}`) && !d.on,
				);
			if (relay)
				await toggleDevice(
					serial as string,
					relay.name,
					relay.kind,
					true,
					typeof relay.raw.subtype === "string" ? relay.raw.subtype : "",
				);
			return setVspSpeed(serial as string, speedId, pumpId);
		},
		onMutate: async ({ pumpId, speedId, closeRelay }) => {
			// The pick itself is the memory's best source — recorded before any
			// poll gets a say, so turning the pump off cannot unlearn it.
			if (serial) rememberSpeed(serial, pumpId, speedId);
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			const prevPanel = panel.snapshot();
			qc.setQueryData(qk, (old: VspPump[] | undefined) =>
				old?.map((p) =>
					p.pumpId === pumpId
						? {
								...p,
								running: true,
								speeds: p.speeds.map((sp) => ({
									...sp,
									active: sp.id === speedId,
								})),
							}
						: p,
				),
			);
			// Only where this mutation is actually closing the relay: without
			// that command the relay stays open, and pinning its switch on
			// would be inventing a state the panel never reaches.
			if (closeRelay)
				for (const n of qc
					.getQueryData<VspPump[]>(qk)
					?.find((p) => p.pumpId === pumpId)?.auxes ?? [])
					panel.setDeviceState(`aux_${n}`, "1");
			return { prev, prevPanel };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
			if (ctx) panel.restore(ctx.prevPanel);
		},
		// The pump's aux relay may have switched on, so refresh the panel too.
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.panel(uid, serial ?? "-") });
		},
	});
}

/**
 * Every pump slot the panel has, empty ones included.
 *
 * Two requests for all twenty, and never polled. What this answers is which
 * slot holds which pump, which cannot change while anybody is looking at it —
 * installing a pump is not something that happens between refetches. It moves
 * when this app's own writes move it, and those invalidate it.
 */
export function useVspSlots(serial: string | undefined) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.vspSlots(uid, serial ?? "-"),
		queryFn: uid && serial ? () => getVspSlots(serial) : skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * The per-slot definitions: unit, model, and the speeds the panel runs unasked.
 *
 * One request per *installed* slot, so it is gated on the slot table having
 * found one — the chained shape `scheduleSpeeds` uses, and for the sharper
 * version of its reason. There are twenty slots and most pads fill none of
 * them; asking unconditionally would buy a bare panel twenty rejected requests
 * to learn nothing, every cycle, forever.
 *
 * Never polled and persisted, because this is the most static thing the app
 * reads. It is also not only the setup pages' data: `unit` is what tells the
 * equipment page whether a pump's speeds are RPM or GPM, and that page has no
 * other source for it.
 */
export function useVspDefinitions(serial: string | undefined) {
	const uid = useUserId();
	const slots = useVspSlots(serial);
	const installed = useMemo(
		() => (slots.data ?? []).filter((s) => s.installed).map((s) => s.slotId),
		[slots.data],
	);

	return useQuery({
		queryKey: keys.vspDefs(uid, serial ?? "-"),
		queryFn:
			uid && serial && installed.length
				? async () => {
						// One at a time, which is how the panel answers anyway: it
						// serialises commands over RS-485, so firing these together
						// does not make them land sooner and does put three requests
						// in a queue that everything else on screen is also waiting
						// in. `getScheduleSpeeds` reads its per-pump table the same
						// way, and for the same reason.
						const defs: VspDefinition[] = [];
						for (const slotId of installed) {
							try {
								defs.push(await getVspDefinition(serial, slotId));
							} catch {
								// A slot that will not describe itself costs its own
								// unit label and nothing else, so the rest still load.
							}
						}
						return defs;
					}
				: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * The unit one pump counts its speeds in, for labelling them.
 *
 * Falls back to RPM rather than to nothing. A speed with no unit beside it
 * reads as a bare number and invites the reader to supply the wrong one from
 * habit, which is the whole failure this exists to prevent — and RPM is what
 * the overwhelming majority of these pumps actually are. The fallback is only
 * ever seen before the definitions land or on a panel that declines to say.
 */
export function useSpeedUnit(serial: string | undefined, slotId?: number) {
	const defs = useVspDefinitions(serial);
	const def = defs.data?.find((d) => d.slotId === slotId);
	return (def?.unit || "rpm").toUpperCase();
}

/** One slot's eight speeds and aux bindings, for the page that edits them. */
export function useVspSlotSpeeds(
	serial: string | undefined,
	slotId: number | undefined,
) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.vspSlotSpeeds(uid, serial ?? "-", slotId ?? 0),
		queryFn:
			uid && serial && slotId
				? () => getVspSlotSpeeds(serial, slotId)
				: skipToken,
		staleTime: STALE_MS,
		refetchOnWindowFocus: false,
	});
}

/**
 * The pump configuration writes.
 *
 * None of these has ever been sent to a panel — not by this app, not by
 * upstream, not by anybody who wrote any of it down. What they have instead is
 * the vendor's own client, which builds these exact query strings, and that is
 * the strongest evidence available short of firing one. It is not the same
 * thing as having fired one.
 *
 * They take no hold key. Hold keys exist so a poll cannot overwrite a light
 * that is still pulsing or a pad that is still settling, and both are about
 * equipment doing something in the world over time. Nothing here asks equipment
 * to do anything: these change what the panel *knows*, the answer is true the
 * moment it is stored, and a refetch that lands immediately after simply reads
 * back what was written.
 *
 * Optimistic on the same model as `useSetPoint` — snapshot, patch, roll back on
 * rejection, invalidate on settle — because a name typed into a dialog should
 * appear when the dialog closes and not a request later.
 */
export function useSetPumpName(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.vspSlots(uid, serial ?? "-");
	return useMutation({
		mutationFn: ({ slotId, name }: { slotId: number; name: string }) =>
			setVspName(serial as string, slotId, name),
		onMutate: async ({ slotId, name }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData<VspSlot[]>(qk);
			qc.setQueryData(qk, (old: VspSlot[] | undefined) =>
				old?.map((s) => (s.slotId === slotId ? { ...s, name } : s)),
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		// The equipment page reads pump names out of its own query, which has no
		// idea this one moved.
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.vsp(uid, serial ?? "-") });
		},
	});
}

/**
 * Rename a speed and set what it is worth, together.
 *
 * Two commands, because the panel has no single one that carries both, and the
 * dialog that calls this edits both at once. Only what actually changed is
 * sent: reasserting a name that was already right would be a second write on
 * an RS-485 line for no reason, and every command sent is a chance to be
 * rejected.
 *
 * Sequential rather than parallel. The panel answers one command at a time and
 * two in flight against the same slot is the shape most likely to find that
 * out the hard way.
 */
export function useSetSpeed(serial: string | undefined, slotId: number) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.vspSlotSpeeds(uid, serial ?? "-", slotId);
	return useMutation({
		mutationFn: async ({
			speedId,
			name,
			value,
		}: {
			speedId: number;
			name?: string;
			value?: number;
		}) => {
			if (name !== undefined)
				await setSpeedName(serial as string, slotId, speedId, name);
			if (value !== undefined)
				await setSpeedNameValue(serial as string, slotId, speedId, value);
		},
		onMutate: async ({ speedId, name, value }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData<VspSlotSetup>(qk);
			qc.setQueryData(qk, (old: VspSlotSetup | undefined) =>
				old
					? {
							...old,
							speeds: old.speeds.map((s) =>
								s.id === speedId
									? {
											...s,
											name: name ?? s.name,
											rpm: value ?? s.rpm,
										}
									: s,
							),
						}
					: old,
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.vsp(uid, serial ?? "-") });
		},
	});
}

/**
 * Move a speed from one aux relay to another, or off relays entirely.
 *
 * The panel stores this the other way round from how anyone edits it: the
 * binding lives on the *aux*, one speed each, and there is no command that
 * takes a speed and asks where it should go. So a move is two writes — clear
 * the relay the speed used to be on, then claim the new one — and clearing is
 * `speedId: 0` with the aux still named, since no unassign command exists.
 *
 * Order matters. Releasing first means a rejected second write leaves the speed
 * on no relay, which is visible and recoverable; claiming first would leave one
 * speed on two relays if the release failed, and the panel would then answer
 * for a pump twice.
 *
 * This is the write behind `pumpForDevice`, so it decides which pump the rest
 * of the app believes a relay belongs to — hence the panel invalidation
 * alongside.
 */
export function useSetAuxSpeed(serial: string | undefined, slotId: number) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.vspSlotSpeeds(uid, serial ?? "-", slotId);
	return useMutation({
		mutationFn: async ({
			speedId,
			auxId,
			previousAuxId,
		}: {
			speedId: number;
			/** The aux to bind to, or 0 to leave this speed on no relay. */
			auxId: number;
			previousAuxId: number;
		}) => {
			if (previousAuxId && previousAuxId !== auxId)
				await setAuxSpeed(serial as string, slotId, 0, previousAuxId);
			if (auxId) await setAuxSpeed(serial as string, slotId, speedId, auxId);
		},
		onMutate: async ({ speedId, auxId, previousAuxId }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData<VspSlotSetup>(qk);
			qc.setQueryData(qk, (old: VspSlotSetup | undefined) =>
				old
					? {
							...old,
							auxSpeeds: old.auxSpeeds.map((s, i) => {
								if (previousAuxId && i === previousAuxId - 1) return 0;
								if (auxId && i === auxId - 1) return speedId;
								return s;
							}),
						}
					: old,
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.vsp(uid, serial ?? "-") });
		},
	});
}

/**
 * One field of a pump's definition — the master speeds.
 *
 * `set_vsp_definition` carries exactly one field per request, which is why this
 * takes one rather than a patch object. Only four of its seven fields are
 * reachable from here: min, max, priming and freeze protection. The other three
 * decide what the slot *is* — its application, its model — and are read-only in
 * this app, since getting one wrong does not run a pump at a wrong speed, it
 * teaches the panel a wrong fact about hardware and leaves it there.
 */
export function useSetPumpDefinition(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.vspDefs(uid, serial ?? "-");
	return useMutation({
		mutationFn: ({
			slotId,
			field,
			value,
		}: {
			slotId: number;
			field: Extract<
				VspDefinitionField,
				| "min_speed"
				| "max_speed"
				| "prime_speed"
				| "prime_duration"
				| "freezeprotect_speed"
			>;
			value: number;
		}) => setVspDefinitionField(serial as string, slotId, field, value),
		onMutate: async ({ slotId, field, value }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData<VspDefinition[]>(qk);
			const patch: Record<string, keyof VspDefinition> = {
				min_speed: "min",
				max_speed: "max",
				prime_speed: "primeSpeed",
				prime_duration: "primeDurationMinutes",
				freezeprotect_speed: "freezeProtectSpeed",
			};
			qc.setQueryData(qk, (old: VspDefinition[] | undefined) =>
				old?.map((d) =>
					d.slotId === slotId ? { ...d, [patch[field]]: value } : d,
				),
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/**
 * Colour-light zones. One mutation for all of it, because the panel treats
 * colour and brightness as the same command and a zone's state comes back the
 * same way whichever was sent.
 *
 * A rename joins them but does not behave like them. `set_iclzone_name` is
 * configuration: it changes what a zone is called and asks no fixture to do
 * anything, so there is no pulse sequence to sit out, nothing transient for a
 * poll to catch, and nothing to wait fifteen seconds for. It gets the
 * invalidation the others get and none of the machinery around it.
 */
export function useIclZone(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
		mutationKey: [...holdKey(serial), "icl"],
		mutationFn: async (v: IclChange) => {
			const id = v.zoneId;
			const res =
				v.kind === "power"
					? await iclZoneOnOff(serial as string, id, v.on)
					: v.kind === "color"
						? await iclSetColor(serial as string, id, v.colorId, v.dim)
						: v.kind === "brightness"
							? await iclSetBrightness(serial as string, id, v.dim)
							: v.kind === "rename"
								? await iclSetZoneName(serial as string, id, v.name)
								: await iclSetCustomColor(
										serial as string,
										id,
										v.rgbw[0],
										v.rgbw[1],
										v.rgbw[2],
										v.rgbw[3],
									);
			// Colour changes cycle the fixture, so they hold like a light.
			// Brightness applies at once and needs no wait at all, and a rename
			// never reached the fixture in the first place.
			if (!QUIET_ICL_CHANGES.has(v.kind)) await settle(LIGHT_HOLD_MS);
			return res;
		},
		// As in useActuate: an in-flight poll would land mid-pulse. The two changes
		// that do not disturb the pad have no poll to protect from.
		onMutate: (v) =>
			QUIET_ICL_CHANGES.has(v.kind) ? undefined : panel.cancel(),
		onSettled: () => panel.invalidate(),
	});
}

/**
 * The zone changes that neither hold nor silence the polls.
 *
 * Everything else this mutation sends starts a sequence the fixture works
 * through — a colour is programmed by pulsing the relay, and switching a zone on
 * programs one — and while that runs the panel reports transient state for the
 * whole pad, which is what the hold and the cancelled polls exist to hide.
 * Brightness and a rename do neither: one is a level the driver applies as it
 * arrives, the other never leaves the controller. Holding either would put a
 * spinner and fifteen dead seconds on a change that finished before the response
 * came back.
 */
const QUIET_ICL_CHANGES = new Set<IclChange["kind"]>(["brightness", "rename"]);

/** Rename the system in the iAqualink account, then refresh the system list. */
export function useSetDeviceName(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => setDeviceName(serial as string, name),
		onSuccess: () => qc.invalidateQueries({ queryKey: keys.systems(uid) }),
	});
}

/**
 * Online/offline for one system. Costs a request per card on the systems list,
 * so this is polled far more slowly than a system's own snapshot.
 */
export function useDeviceStatus(serial: string) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.status(uid, serial),
		queryFn: uid ? () => getDeviceStatus(serial) : skipToken,
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: false,
		staleTime: POLL_MS * 2,
		refetchOnWindowFocus: false,
	});
}

/** Attach a system to the account, then refresh the list it appears in. */
export function useAddDevice() {
	const uid = useUserId();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ serial, name }: { serial: string; name: string }) =>
			addDevice(serial, name),
		// Awaited, not fired and forgotten: whoever added the system is about to
		// be shown the list, and it should already have the new one in it.
		onSuccess: () => qc.refetchQueries({ queryKey: keys.systems(uid) }),
	});
}

// -- Schedules --

/**
 * The panel's own timed programs, for a screen that wants only these.
 *
 * The same two queries `usePanel` runs, under the same keys, so a page reached
 * from anywhere that mounts the panel finds them already in hand — react-query
 * serves both from the one cache entry and no second request is sent. They stay
 * separate hooks so that landing directly on a schedules URL, where no panel is
 * mounted, still fetches what it needs.
 *
 * Kept in step with `usePanel`'s copies deliberately: two sets of options on
 * one key is one set too many, and whichever mounted first would decide the
 * cadence for both.
 */
export function useSchedules(serial: string | undefined) {
	const uid = useUserId();
	const quiet = useIsMutating({ mutationKey: holdKey(serial) }) > 0;
	return useQuery({
		queryKey: keys.schedules(uid, serial ?? "-"),
		queryFn: uid && serial ? () => getScheduleList(serial) : skipToken,
		...panelOptions(quiet, ONETOUCH_POLL_MS),
		// Persisted, so like the macros it has to outlive maxAge to come back.
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * The equipment a schedule can name, which a schedule list cannot say for
 * itself — it reports "device 12" and never "Waterfall".
 *
 * Deliberately not on `panelOptions`: this is how the pad is wired, not what it
 * is doing. It changes when somebody installs equipment, which is to say
 * roughly never, so there is no interval at all and it is allowed to go stale
 * indefinitely. It is also the one half of this page that may be kept across a
 * reload — see `persist.ts` — so on a device that has been here before this
 * costs nothing and the names are on screen before the network answers.
 */
export function useScheduleDevices(serial: string | undefined) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.scheduleDevices(uid, serial ?? "-"),
		queryFn: uid && serial ? () => getScheduleDevices(serial, "1") : skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: (count: number, error: unknown) =>
			error instanceof AqualinkError && error.status === 401
				? false
				: count < 2,
		// Persisted, so like the macros it has to outlive maxAge to come back.
		gcTime: PERSIST_GC_TIME_MS,
	});
}

/**
 * The cached schedule list, in the shape the three writes need.
 *
 * The same split `usePanelCache` makes, and for the same reason: a mutation has
 * to cancel in-flight reads, keep a copy to put back, and edit the list in
 * place, and doing that inline three times over would be three chances to get
 * the rollback wrong.
 */
function useScheduleCache(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const qk = keys.schedules(uid, serial ?? "-");
	return {
		cancel: () => qc.cancelQueries({ queryKey: qk }),
		snapshot: () => qc.getQueryData<ScheduleList>(qk),
		restore: (prev: ScheduleList | undefined) => qc.setQueryData(qk, prev),
		/** Rewrite the schedules in place, leaving the panel's own counts alone. */
		write: (
			fn: (schedules: ScheduleList["schedules"]) => ScheduleList["schedules"],
		) => {
			const cur = qc.getQueryData<ScheduleList>(qk);
			if (cur) qc.setQueryData(qk, { ...cur, schedules: fn(cur.schedules) });
		},
		/**
		 * Take the panel's own reply as the new truth when it sent one. All three
		 * operations answer with the whole list, which is better than anything
		 * this side could compose — an add in particular, where the panel picks
		 * the id and nothing here can predict it.
		 */
		seed: (list: ScheduleList | null) => {
			if (list) qc.setQueryData(qk, list);
		},
		/**
		 * The whole panel, not just the schedules. A program whose window covers
		 * the present moment starts acting the instant it exists, so the relay
		 * states on the other screens can change as a result of an edit made
		 * here — refreshing only this list would leave the equipment page showing
		 * the state from before.
		 *
		 * Started and not awaited, which is the part that matters. React Query
		 * dispatches a mutation's success only after `onSettled` resolves, so
		 * returning this promise keeps `isPending` true until every panel screen
		 * has refetched — and the panel answers one command at a time. Deleting a
		 * program left its own dialog's buttons disabled for as long as that took,
		 * as though the delete were still running when it had long finished. The
		 * optimistic write already shows the right answer; the refetch only
		 * confirms it, and nothing needs to wait on being told it was right.
		 */
		invalidate: () => {
			void qc.invalidateQueries({ queryKey: keys.panel(uid, serial ?? "-") });
		},
	};
}

/**
 * The id a new program wears for the moment before the panel names it.
 *
 * The panel assigns the real one, and the ids it hands out are neither
 * sequential nor free of gaps — this pool returned 0, 1, 2, 4, 3, 5, and reuses
 * the ids of programs that have been deleted — so nothing here can predict it.
 * That is why this is a sentinel rather than a guess: it is deliberately a
 * number no panel would ever issue, so a row wearing it can be recognised as
 * not-yet-real by anything that cares. It sorts last, which is where a program
 * just made belongs on a page ordered oldest first.
 */
export const PENDING_SCHEDULE_ID = Number.MAX_SAFE_INTEGER;

/**
 * Add a program.
 *
 * Optimistic like the other two, which took a sentinel to manage: an added
 * program has no id until the panel answers, and the id is what every row on
 * the page is keyed and sorted by. Waiting for the answer instead made adding
 * the one action in the feature that visibly did nothing for a second — the
 * dialog closed on an unchanged list, which reads as a failure rather than as
 * a wait.
 *
 * The row is provisional in a way callers must respect: its id addresses
 * nothing, so anything that would send it back to the panel has to be held
 * until the real list arrives.
 */
export function useAddSchedule(serial: string | undefined) {
	const cache = useScheduleCache(serial);
	return useMutation({
		mutationFn: (spec: ScheduleSpec) => addSchedule(serial as string, spec),
		onMutate: async (spec) => {
			await cache.cancel();
			const prev = cache.snapshot();
			cache.write((schedules) => [
				...schedules,
				{
					id: PENDING_SCHEDULE_ID,
					deviceId: spec.deviceId,
					startHrs: spec.startHrs,
					startMins: spec.startMins,
					stopHrs: spec.stopHrs,
					stopMins: spec.stopMins,
					days: spec.days,
					vspId: spec.vspId ?? null,
				},
			]);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) cache.restore(ctx.prev);
		},
		onSuccess: (list) => cache.seed(list),
		onSettled: () => cache.invalidate(),
	});
}

/** Change a program's equipment, times or days. */
export function useEditSchedule(serial: string | undefined) {
	const cache = useScheduleCache(serial);
	return useMutation({
		mutationFn: ({ id, spec }: { id: number; spec: ScheduleSpec }) =>
			editSchedule(serial as string, id, spec),
		onMutate: async ({ id, spec }) => {
			await cache.cancel();
			const prev = cache.snapshot();
			cache.write((schedules) =>
				schedules.map((s) => (s.id === id ? { ...s, ...spec } : s)),
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) cache.restore(ctx.prev);
		},
		onSuccess: (list) => cache.seed(list),
		onSettled: () => cache.invalidate(),
	});
}

/** Remove a program. */
export function useDeleteSchedule(serial: string | undefined) {
	const cache = useScheduleCache(serial);
	return useMutation({
		mutationFn: (id: number) => deleteSchedule(serial as string, id),
		onMutate: async (id) => {
			await cache.cancel();
			const prev = cache.snapshot();
			cache.write((schedules) => schedules.filter((s) => s.id !== id));
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) cache.restore(ctx.prev);
		},
		onSuccess: (list) => cache.seed(list),
		onSettled: () => cache.invalidate(),
	});
}

/**
 * The pump speeds a schedule can name, for a page that lists programs without
 * mounting the panel. Same key and same options as `usePanel`'s copy — see
 * `useSchedules` for why both exist and why they must not disagree.
 */
export function useScheduleSpeeds(
	serial: string | undefined,
	pumps: readonly ScheduleDevice[],
) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.scheduleSpeeds(uid, serial ?? "-"),
		queryFn:
			uid && serial && pumps.length
				? () => getScheduleSpeeds(serial, pumps)
				: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		gcTime: PERSIST_GC_TIME_MS,
	});
}

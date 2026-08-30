import {
	skipToken,
	useIsMutating,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { VspPump } from "#/lib/aqualink/client";
import {
	addDevice,
	devicesScreen,
	enableHpm,
	getDeviceStatus,
	homeScreen,
	iclSetBrightness,
	iclSetColor,
	iclSetCustomColor,
	iclZoneOnOff,
	listSystems,
	listVspPumps,
	login,
	logout,
	onetouchScreen,
	setDeviceName,
	setHpmSetPoint,
	setLightColor,
	setOnetouch,
	setTemps,
	setVspSpeed,
	switchHpmMode,
	toggleDevice,
} from "#/lib/aqualink/client";
import { HPM_TEMP_PARAM } from "#/lib/aqualink/enums";
import { loadSession } from "#/lib/aqualink/session";
import { AqualinkError } from "#/lib/aqualink/types";
import { normalize } from "#/lib/iaqualink/normalize";
import type { PoolDevice, PoolSnapshot, Raw } from "#/lib/iaqualink/types";
import { keys } from "#/lib/keys";
import { PERSIST_GC_TIME_MS } from "#/lib/persist";

/** What can be asked of a zone. Colour carries brightness, as the API does. */
export type IclChange =
	| { kind: "power"; zoneId: number; on: boolean }
	| { kind: "color"; zoneId: number; colorId: number; dim: number }
	| { kind: "brightness"; zoneId: number; dim: number }
	| { kind: "custom"; zoneId: number; rgbw: [number, number, number, number] };

/** Poll cadence: the panel is the source of truth, we just mirror it. */
const POLL_MS = 10_000;

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
 * This window covers toggles and ICL changes; a WaterColors effect change
 * computes its own from the target id — see waterColorsHold below.
 */
const LIGHT_HOLD_MS = 15_000;

/** Pump speeds are near-static, so they ride a much slower cycle. */
const VSP_POLL_MS = POLL_MS * 2;

/** Macros are edited at the panel, so this is drift correction, not tracking. */
const ONETOUCH_POLL_MS = POLL_MS * 6;

const settle = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Who the cache belongs to. Empty until the session resolves, which also keeps
 * every account-scoped query disabled until there is an account to scope to.
 */
export function useUserId(): string {
	return useSession().data?.userId ?? "";
}

export function useSession() {
	return useQuery({
		queryKey: keys.session(),
		queryFn: () => loadSession(),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
}

export function useLogin() {
	const uid = useUserId();
	const qc = useQueryClient();
	return useMutation({
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
		onSuccess: () => qc.clear(),
	});
}

export function useSystems(enabled: boolean) {
	const uid = useUserId();
	return useQuery({
		queryKey: keys.systems(uid),
		queryFn: enabled && uid ? () => listSystems() : skipToken,
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: false,
		// Double the interval, so a healthy cycle never reads as stale.
		staleTime: POLL_MS * 2,
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
	// Double the interval: equal to it, data would turn stale at the very
	// moment the next poll is due — so the header would read "10s ago" every
	// cycle, on a panel that was answering perfectly. Stale should mean a poll
	// was actually missed.
	staleTime: interval * 2,
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
	| { kind: "actuate"; vars: { device: PoolDevice; on: boolean } }
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
		if (h.kind === "actuate")
			devices = devices.map((d) =>
				d.name === h.vars.device.name ? { ...d, on: h.vars.on } : d,
			);
		else if (h.kind === "color")
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
			else if (
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

	const snapshot = useMemo(
		() =>
			home.data && devices.data
				? normalize(
						serial ?? "",
						home.data,
						devices.data.devices,
						devices.data.icl,
						onetouch.data,
					)
				: undefined,
		[serial, home.data, devices.data, onetouch.data],
	);
	// Pinned over what the polls report: a light mid-change reads as its
	// target until its mutation resolves, so a mid-pulse "off" never paints.
	const data =
		snapshot && holds.length ? applyHolds(snapshot, holds) : snapshot;

	return {
		data,
		// All three, so the screen never paints half-built. Macros can satisfy
		// this from storage where the readings cannot — which is the point of
		// splitting them: the cacheable one stops holding up the rest.
		isPending: home.isPending || devices.isPending || onetouch.isPending,
		isFetching: home.isFetching || devices.isFetching,
		isSuccess: home.isSuccess && devices.isSuccess,
		isStale: home.isStale || devices.isStale,
		dataUpdatedAt: Math.min(home.dataUpdatedAt, devices.dataUpdatedAt),
		refetch: () => {
			home.refetch();
			devices.refetch();
			onetouch.refetch();
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
			? normalize(s, home, devices.devices, devices.icl, qc.getQueryData(ok))
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
		mutationFn: async ({ device, on }: { device: PoolDevice; on: boolean }) => {
			const res = await toggleDevice(
				serial as string,
				device.name,
				device.kind,
				on,
				typeof device.raw.subtype === "string" ? device.raw.subtype : "",
			);
			// A light pulses its relay before it reads true again, and the pad
			// reports transient state throughout — so the hold runs its window.
			// Nothing else lies about itself, so nothing else waits.
			if (device.kind === "light") await settle(LIGHT_HOLD_MS);
			return res;
		},
		// A poll already in flight when the hold starts would land mid-pulse
		// with the whole pad reading wrong; it is cancelled instead of landed.
		onMutate: ({ device }) =>
			device.kind === "light" ? panel.cancel() : undefined,
		// The pumps too: a relay carrying a variable-speed pump reports its
		// speed on a separate query with a slower cycle, and leaving that behind
		// left one button reading its fill from the snapshot and its selection
		// from data up to a cycle older.
		onSettled: () =>
			Promise.all([
				panel.invalidate(),
				qc.invalidateQueries({ queryKey: keys.vsp(uid, serial ?? "-") }),
			]),
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
 * How long a WaterColors effect change holds: a reset, then one pulse per
 * step past the first colour.
 *
 * Watched at the pool: the light goes dark for 8–10 seconds — the panel
 * holding power off until the fixture falls back to the head of its table —
 * and only then starts pulsing, one step per pulse. The reset lands ON the
 * first colour, so Alpine White (id 1) needs no pulses at all and the count
 * is id − 1. The panel does all this blind every time, since neither it nor
 * the API ever knows what colour is running — which is why the duration
 * depends only on the target. Timed splits at the pool: ~10s dark, then
 * roughly a second per id of pulsing — Cobalt (id 3) ~12s, Spring Green
 * (id 5) ~15s, Magenta (id 8) ~20s all sit close to the line.
 */
const WATERCOLORS_RESET_MS = 10_000;
const WATERCOLORS_STEP_MS = 1_000;
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
		// As in useActuate: an in-flight poll would land mid-pulse.
		onMutate: () => panel.cancel(),
		onSettled: () => panel.invalidate(),
	});
}

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
		queryFn: uid && serial ? () => listVspPumps(serial) : skipToken,
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
	const qk = keys.vsp(uid, serial ?? "-");
	return useMutation({
		mutationFn: async ({
			pumpId,
			speedId,
		}: {
			pumpId: number;
			speedId: number;
		}) => setVspSpeed(serial as string, speedId, pumpId),
		onMutate: async ({ pumpId, speedId }) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: VspPump[] | undefined) =>
				old?.map((p) =>
					p.pumpId === pumpId
						? {
								...p,
								speeds: p.speeds.map((sp) => ({
									...sp,
									active: sp.id === speedId,
								})),
							}
						: p,
				),
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		// The pump's aux relay may have switched on, so refresh the panel too.
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.panel(uid, serial ?? "-") });
		},
	});
}

/**
 * Colour-light zones. One mutation for all of it, because the panel treats
 * colour and brightness as the same command and a zone's state comes back the
 * same way whichever was sent.
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
							: await iclSetCustomColor(
									serial as string,
									id,
									v.rgbw[0],
									v.rgbw[1],
									v.rgbw[2],
									v.rgbw[3],
								);
			// Colour changes cycle the fixture, so they hold like a light.
			// Brightness applies at once and needs no wait at all.
			if (v.kind !== "brightness") await settle(LIGHT_HOLD_MS);
			return res;
		},
		// As in useActuate: an in-flight poll would land mid-pulse.
		onMutate: (v) => (v.kind === "brightness" ? undefined : panel.cancel()),
		onSettled: () => panel.invalidate(),
	});
}

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

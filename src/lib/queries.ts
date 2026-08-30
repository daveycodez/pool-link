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
	pumpForDevice,
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
			// Turning on a relay that carries a variable-speed pump is two
			// commands, always: the relay, then — once the panel has answered —
			// the speed, because the panel does not restore one on its own.
			// The user's last known speed wins, then whatever the table calls
			// active, then the first configured speed as the default.
			if (on) {
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
			// hold as picking id 1. Off is a bare relay drop, and nothing else
			// lies about itself — neither waits.
			if (device.kind === "light" && on) await settle(waterColorsHold(1));
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
 * depends only on the target. 6s base, then 1.5s per id — settled by
 * trial against the pool.
 */
const WATERCOLORS_RESET_MS = 6_000;
const WATERCOLORS_STEP_MS = 1_500;
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
		}: {
			pumpId: number;
			speedId: number;
		}) => {
			// The same two-step as the switch, in the same order: a speed tap
			// on a stopped pump closes the relay first, then sets the speed.
			// Speed alone starts the pump with the relay open, and an open
			// relay is a switch reading off over running water.
			const pump = qc
				.getQueryData<VspPump[]>(qk)
				?.find((p) => p.pumpId === pumpId);
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
		onMutate: async ({ pumpId, speedId }) => {
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
			// The command carries on_off_action "on", so the pump's relay is
			// about to close — its switch reads on now rather than a poll later.
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

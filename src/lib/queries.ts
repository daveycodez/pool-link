import {
	skipToken,
	useIsMutating,
	useMutation,
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
 * The panel serialises commands over RS-485 and keeps reporting a transient
 * state while it works through one — a light is the worst case, since Jandy
 * WaterColors change effect by pulsing the relay and read as off throughout.
 *
 * So a command is not finished when its HTTP call returns; it is finished when
 * the panel has settled. Every mutation stays pending for that long, which
 * makes `isMutating` the single signal the poll needs.
 */
const SETTLE_MS = 5_000;

/** Lights pulse the relay through a sequence, so they take twice as long. */
const LIGHT_SETTLE_MS = 15_000;

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
const panelOptions = (mutating: boolean, interval: number) => ({
	refetchInterval: (mutating ? false : interval) as number | false,
	refetchIntervalInBackground: false,
	// A cycle plus the longest a command can hold the poll. Equal to the
	// interval, data would turn stale at the very moment the next poll is due —
	// so the header would read "10s ago" every cycle, on a panel that was
	// answering perfectly. Stale should mean a poll was actually missed.
	staleTime: interval + LIGHT_SETTLE_MS,
	retry: (count: number, error: unknown) =>
		error instanceof AqualinkError && error.status === 401 ? false : count < 2,
});

export function usePanel(serial: string | undefined) {
	const uid = useUserId();
	// Mutations stay pending until the panel has settled, so this covers both
	// the request and the transient state that follows it.
	const mutating = useIsMutating() > 0;
	const ready = Boolean(serial) && Boolean(uid);

	// skipToken rather than `enabled`: it disables the query and removes the
	// fetcher with it, so a serial that is not there cannot be cast into one.
	// Without it these run before the session names the account and key under
	// an empty user id — every account's cache sharing one bucket.
	const home = useQuery({
		queryKey: keys.home(uid, serial ?? "-"),
		queryFn: ready && serial ? () => homeScreen(serial) : skipToken,
		...panelOptions(mutating, POLL_MS),
	});
	const devices = useQuery({
		queryKey: keys.devices(uid, serial ?? "-"),
		queryFn: ready && serial ? () => devicesScreen(serial) : skipToken,
		...panelOptions(mutating, POLL_MS),
	});
	// Macros change when someone edits them at the panel, which is never in the
	// course of using the app — and this is the one screen worth restoring from
	// storage, since it is names rather than readings.
	const onetouch = useQuery({
		queryKey: keys.onetouch(uid, serial ?? "-"),
		queryFn: ready && serial ? () => onetouchScreen(serial) : skipToken,
		...panelOptions(mutating, ONETOUCH_POLL_MS),
		// The one screen worth keeping: names rather than readings, so a restore
		// is still true. It has to outlive maxAge to survive being restored.
		gcTime: PERSIST_GC_TIME_MS,
	});

	const data = useMemo(
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
		patchZone: (zoneId: number, patch: Raw) => {
			qc.setQueryData(dk, (old: DevicesScreen | undefined) =>
				old && Array.isArray(old.icl)
					? {
							...old,
							icl: old.icl.map((z: unknown) =>
								z &&
								typeof z === "object" &&
								Number((z as Raw).zoneId) === zoneId
									? { ...(z as Raw), ...patch }
									: z,
							),
						}
					: old,
			);
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

/** Optimistic actuation: flip the cache instantly, roll back on failure. */
export function useActuate(serial: string | undefined) {
	const uid = useUserId();
	const qc = useQueryClient();
	const panel = usePanelCache(serial);
	return useMutation({
		mutationFn: async ({ device, on }: { device: PoolDevice; on: boolean }) => {
			const res = await toggleDevice(
				serial as string,
				device.name,
				device.kind,
				on,
				typeof device.raw.subtype === "string" ? device.raw.subtype : "",
			);
			await settle(device.kind === "light" ? LIGHT_SETTLE_MS : SETTLE_MS);
			return res;
		},
		onMutate: async ({ device, on }) => {
			await panel.cancel();
			const prev = panel.snapshot();
			// "1" reads as on through every parser this can touch — isOn for
			// relays and lights, heaterOn for heaters — and "0" as off for both.
			panel.setDeviceState(device.name, on ? "1" : "0");
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
		// The pumps too: a relay carrying a variable-speed pump reports its
		// speed on a separate query with a slower cycle, and leaving that behind
		// left one button reading its fill from the snapshot and its selection
		// from data up to a cycle older.
		onSettled: () => {
			panel.invalidate();
			qc.invalidateQueries({ queryKey: keys.vsp(uid, serial ?? "-") });
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
			await settle(SETTLE_MS);
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
		mutationFn: async (name: string) => {
			const res = await setOnetouch(serial as string, name);
			// A scene moves several pieces of equipment, so it settles slowly.
			await settle(LIGHT_SETTLE_MS);
			return res;
		},
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
		mutationFn: async (
			v: { kind: "power"; on: boolean } | { kind: "mode"; mode: string },
		) => {
			const res =
				v.kind === "power"
					? await enableHpm(serial as string, v.on)
					: await switchHpmMode(serial as string, v.mode);
			await settle(SETTLE_MS);
			return res;
		},
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

/** Set a light's color effect. */
export function useLightColor(serial: string | undefined) {
	const panel = usePanelCache(serial);
	return useMutation({
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
			await settle(LIGHT_SETTLE_MS);
			return res;
		},
		// Effect ids start at 1 and 0 is "off", so choosing one turns the light on.
		onMutate: async ({ name }) => {
			await panel.cancel();
			const prev = panel.snapshot();
			panel.setDeviceState(name, "1");
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
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
	const mutating = useIsMutating() > 0;

	return useQuery({
		queryKey: keys.vsp(uid, serial ?? "-"),
		queryFn: uid && serial ? () => listVspPumps(serial) : skipToken,
		refetchInterval: mutating ? false : VSP_POLL_MS,
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
		}) => {
			const res = await setVspSpeed(serial as string, speedId, pumpId);
			await settle(SETTLE_MS);
			return res;
		},
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
			// Colour changes cycle the fixture, so they settle like a light.
			await settle(v.kind === "brightness" ? SETTLE_MS : LIGHT_SETTLE_MS);
			return res;
		},
		onMutate: async (v) => {
			await panel.cancel();
			const prev = panel.snapshot();
			panel.patchZone(
				v.zoneId,
				v.kind === "power"
					? { zoneStatus: v.on ? "on" : "off" }
					: v.kind === "color"
						? { zoneStatus: "on", zoneColor: v.colorId, dim_level: v.dim }
						: v.kind === "brightness"
							? { dim_level: v.dim }
							: {
									zoneStatus: "on",
									red_val: v.rgbw[0],
									green_val: v.rgbw[1],
									blue_val: v.rgbw[2],
									white_val: v.rgbw[3],
								},
			);
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx) panel.restore(ctx.prev);
		},
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

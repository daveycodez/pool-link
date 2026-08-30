import {
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
import type { PoolDevice, PoolSnapshot } from "#/lib/iaqualink/types";

/** What can be asked of a zone. Colour carries brightness, as the API does. */
export type IclChange =
	| { kind: "power"; zoneId: number; on: boolean }
	| { kind: "color"; zoneId: number; colorId: number; dim: number }
	| { kind: "brightness"; zoneId: number; dim: number }
	| { kind: "custom"; zoneId: number; rgbw: [number, number, number, number] };

/**
 * How long a persisted entry may be reused. Long, because what is kept barely
 * changes — pump wiring moves when someone rewires the pad, and not otherwise
 * — and everything restored is refetched on mount regardless, so age costs at
 * most a stale first paint. It doubles as the gcTime of what gets persisted:
 * a restore older than gcTime is collected on arrival, so the two must agree.
 *
 * The persister applies this to the whole stored blob rather than per query,
 * so the systems list rides the same window. That is harmless for the same
 * reason: it is replaced by a fetch as soon as anything mounts.
 */
export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The gcTime for persisted queries. On the client it must match
 * PERSIST_MAX_AGE_MS or a restore would be collected on arrival — but a finite
 * gcTime is a live setTimeout, and during the prerender that timer is what
 * keeps the build process from exiting (react-query's own server default is
 * Infinity for exactly this reason, and an explicit value overrides it).
 */
const PERSIST_GC_TIME_MS =
	typeof window === "undefined" ? Infinity : PERSIST_MAX_AGE_MS;

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

export const keys = {
	session: () => ["session"] as const,
	systems: () => ["systems"] as const,
	/** Everything read from one panel, so a mutation can invalidate the lot. */
	panel: (serial: string) => ["panel", serial] as const,
	home: (serial: string) => ["panel", serial, "home"] as const,
	devices: (serial: string) => ["panel", serial, "devices"] as const,
	onetouch: (serial: string) => ["panel", serial, "onetouch"] as const,
	status: (serial: string) => ["status", serial] as const,
	/** Prefix that matches every system's status query. */
	statuses: () => ["status"] as const,
	vsp: (serial: string) => ["vsp", serial] as const,
};

export function useSession() {
	return useQuery({
		queryKey: keys.session(),
		queryFn: () => loadSession(),
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
}

export function useLogin() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ email, password }: { email: string; password: string }) =>
			login(email, password),
		onSuccess: (session) => {
			// Seed the session query with the just-created session so the
			// dashboard doesn't bounce back to /login before a refetch lands.
			qc.setQueryData(keys.session(), session);
			qc.invalidateQueries({ queryKey: keys.systems() });
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
	return useQuery({
		queryKey: keys.systems(),
		queryFn: () => listSystems(),
		enabled,
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
function panelQuery<T>(
	queryKey: readonly unknown[],
	queryFn: () => Promise<T>,
	serial: string | undefined,
	mutating: boolean,
	interval: number,
) {
	return {
		queryKey,
		queryFn,
		enabled: Boolean(serial),
		refetchInterval: (mutating ? false : interval) as number | false,
		refetchIntervalInBackground: false,
		// A cycle plus the longest a command can hold the poll. Equal to the
		// interval, data would turn stale at the very moment the next poll is
		// due — so the header would read "10s ago" every cycle, on a panel that
		// was answering perfectly. Stale should mean a poll was actually missed.
		staleTime: interval + LIGHT_SETTLE_MS,
		retry: (count: number, error: unknown) =>
			error instanceof AqualinkError && error.status === 401
				? false
				: count < 2,
	};
}

export function usePanel(serial: string | undefined) {
	// Mutations stay pending until the panel has settled, so this covers both
	// the request and the transient state that follows it.
	const mutating = useIsMutating() > 0;
	const id = serial as string;

	const home = useQuery(
		panelQuery(
			keys.home(serial ?? "-"),
			() => homeScreen(id),
			serial,
			mutating,
			POLL_MS,
		),
	);
	const devices = useQuery(
		panelQuery(
			keys.devices(serial ?? "-"),
			() => devicesScreen(id),
			serial,
			mutating,
			POLL_MS,
		),
	);
	// Macros change when someone edits them at the panel, which is never in the
	// course of using the app — and this is the one screen worth restoring from
	// storage, since it is names rather than readings.
	const onetouch = useQuery({
		...panelQuery(
			keys.onetouch(serial ?? "-"),
			() => onetouchScreen(id),
			serial,
			mutating,
			ONETOUCH_POLL_MS,
		),
		// The one screen worth keeping: names rather than readings, so a restore
		// is still true. It has to outlive maxAge to survive being restored.
		gcTime: PERSIST_GC_TIME_MS,
	});

	const data = useMemo(
		() =>
			home.data && devices.data
				? normalize(
						id,
						home.data,
						devices.data.devices,
						devices.data.icl,
						onetouch.data,
					)
				: undefined,
		[id, home.data, devices.data, onetouch.data],
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

/** Optimistic actuation: flip the cache instantly, roll back on failure. */
export function useActuate(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
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
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old) return old;
				return {
					...old,
					devices: old.devices.map((d) =>
						d.id === device.id ? { ...d, on } : d,
					),
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		// The pumps too: a relay carrying a variable-speed pump reports its
		// speed on a separate query with a slower cycle, and leaving that behind
		// left one button reading its fill from the snapshot and its selection
		// from data up to a cycle older.
		onSettled: () => {
			qc.invalidateQueries({ queryKey: qk });
			qc.invalidateQueries({ queryKey: keys.vsp(serial ?? "-") });
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
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
	return useMutation({
		mutationFn: async ({ name, value }: { name: string; value: number }) => {
			const snap = qc.getQueryData(qk) as PoolSnapshot | undefined;
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
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old) return old;
				return {
					...old,
					devices: old.devices.map((d) =>
						d.name === name ? { ...d, value: String(value) } : d,
					),
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/**
 * Run a OneTouch macro. The command toggles rather than sets, and the panel
 * reports one macro at a time as the active configuration — so starting one
 * ends whichever was running.
 */
export function useOneTouch(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
	return useMutation({
		mutationFn: async (name: string) => {
			const res = await setOnetouch(serial as string, name);
			// A scene moves several pieces of equipment, so it settles slowly.
			await settle(LIGHT_SETTLE_MS);
			return res;
		},
		onMutate: async (name) => {
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old) return old;
				const running = old.macros.find((m) => m.name === name)?.on;
				return {
					...old,
					macros: old.macros.map((m) => ({
						...m,
						on: m.name === name ? !running : false,
					})),
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/** Enable the heat pump, or switch it between heating and chilling. */
export function useHeatPump(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
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
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old?.heatPump) return old;
				return {
					...old,
					heatPump:
						v.kind === "power"
							? { ...old.heatPump, on: v.on }
							: { ...old.heatPump, mode: v.mode },
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/** Set a light's color effect. */
export function useLightColor(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
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
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old) return old;
				return {
					...old,
					devices: old.devices.map((d) =>
						d.name === name ? { ...d, on: true } : d,
					),
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
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
	const mutating = useIsMutating() > 0;

	return useQuery({
		queryKey: keys.vsp(serial ?? "-"),
		queryFn: () => listVspPumps(serial as string),
		enabled: Boolean(serial),
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
	const qc = useQueryClient();
	const qk = keys.vsp(serial ?? "-");
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
			qc.invalidateQueries({ queryKey: keys.panel(serial ?? "-") });
		},
	});
}

/**
 * Colour-light zones. One mutation for all of it, because the panel treats
 * colour and brightness as the same command and a zone's state comes back the
 * same way whichever was sent.
 */
export function useIclZone(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.panel(serial ?? "-");
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
			await qc.cancelQueries({ queryKey: qk });
			const prev = qc.getQueryData(qk);
			qc.setQueryData(qk, (old: ReturnType<typeof normalize> | undefined) => {
				if (!old) return old;
				return {
					...old,
					icl: old.icl.map((z) =>
						z.zoneId !== v.zoneId
							? z
							: v.kind === "power"
								? { ...z, on: v.on }
								: v.kind === "color"
									? { ...z, on: true, colorId: v.colorId }
									: v.kind === "brightness"
										? { ...z, dim: v.dim }
										: { ...z, on: true, rgbw: v.rgbw },
					),
				};
			});
			return { prev };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.prev) qc.setQueryData(qk, ctx.prev);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/** Rename the system in the iAqualink account, then refresh the system list. */
export function useSetDeviceName(serial: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => setDeviceName(serial as string, name),
		onSuccess: () => qc.invalidateQueries({ queryKey: keys.systems() }),
	});
}

/**
 * Online/offline for one system. Costs a request per card on the systems list,
 * so this is polled far more slowly than a system's own snapshot.
 */
export function useDeviceStatus(serial: string) {
	return useQuery({
		queryKey: keys.status(serial),
		queryFn: () => getDeviceStatus(serial),
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: false,
		staleTime: POLL_MS * 2,
		refetchOnWindowFocus: false,
	});
}

/** Attach a system to the account, then refresh the list it appears in. */
export function useAddDevice() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ serial, name }: { serial: string; name: string }) =>
			addDevice(serial, name),
		// Awaited, not fired and forgotten: whoever added the system is about to
		// be shown the list, and it should already have the new one in it.
		onSuccess: () => qc.refetchQueries({ queryKey: keys.systems() }),
	});
}

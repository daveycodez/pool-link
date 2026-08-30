import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { VspPump } from "#/lib/aqualink/client";
import {
	addDevice,
	enableHpm,
	getDeviceStatus,
	iclSetBrightness,
	iclSetColor,
	iclSetCustomColor,
	iclZoneOnOff,
	listSystems,
	listVspPumps,
	login,
	logout,
	setDeviceName,
	setHpmSetPoint,
	setLightColor,
	setOnetouch,
	setTemps,
	setVspSpeed,
	snapshot,
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

const settle = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const keys = {
	session: () => ["session"] as const,
	systems: () => ["systems"] as const,
	snapshot: (serial: string) => ["snapshot", serial] as const,
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
	});
}

export function useSnapshot(serial: string | undefined) {
	// Mutations stay pending until the panel has settled, so this covers both
	// the request and the transient state that follows it.
	const mutating = useIsMutating() > 0;

	return useQuery({
		queryKey: keys.snapshot(serial ?? "-"),
		queryFn: async () => {
			const { home, devices, icl, onetouch } = await snapshot(serial as string);
			return normalize(serial as string, home, devices, icl, onetouch);
		},
		enabled: Boolean(serial),
		refetchInterval: mutating ? false : POLL_MS,
		refetchIntervalInBackground: false,
		// Long enough to cover the longest a command can hold the poll, plus a
		// cycle. Stale then means a poll was actually missed — a backgrounded
		// tab, a failed request — not a command still settling.
		staleTime: LIGHT_SETTLE_MS + POLL_MS,
		retry: (count, error) =>
			error instanceof AqualinkError && error.status === 401
				? false
				: count < 2,
	});
}

/** Optimistic actuation: flip the cache instantly, roll back on failure. */
export function useActuate(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.snapshot(serial ?? "-");
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
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
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
	const qk = keys.snapshot(serial ?? "-");
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
	const qk = keys.snapshot(serial ?? "-");
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
	const qk = keys.snapshot(serial ?? "-");
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
	const qk = keys.snapshot(serial ?? "-");
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
			qc.invalidateQueries({ queryKey: keys.snapshot(serial ?? "-") });
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
	const qk = keys.snapshot(serial ?? "-");
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

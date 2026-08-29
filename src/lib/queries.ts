import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getDeviceStatus,
	listSystems,
	login,
	logout,
	setDeviceName,
	setLightColor,
	setTemps,
	snapshot,
	toggleDevice,
} from "#/lib/aqualink/client";
import { loadSession } from "#/lib/aqualink/session";
import { AqualinkError } from "#/lib/aqualink/types";
import { normalize } from "#/lib/iaqualink/normalize";
import type { PoolDevice } from "#/lib/iaqualink/types";

/** Poll cadence: the panel is the source of truth, we just mirror it. */
const POLL_MS = 5_000;

export const keys = {
	session: () => ["session"] as const,
	systems: () => ["systems"] as const,
	snapshot: (serial: string) => ["snapshot", serial] as const,
	status: (serial: string) => ["status", serial] as const,
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
		staleTime: 60_000,
	});
}

export function useSnapshot(serial: string | undefined) {
	return useQuery({
		queryKey: keys.snapshot(serial ?? "-"),
		queryFn: async () => {
			const { home, devices } = await snapshot(serial as string);
			return normalize(serial as string, home, devices);
		},
		enabled: Boolean(serial),
		refetchInterval: POLL_MS,
		refetchIntervalInBackground: false,
		// Longer than the poll so healthy cycles never flip the Live chip:
		// stale means a poll was actually missed — a backgrounded tab, a failed
		// request — not simply the gap between two successful ones.
		staleTime: POLL_MS * 2,
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
		mutationFn: ({ device, on }: { device: PoolDevice; on: boolean }) =>
			toggleDevice(
				serial as string,
				device.name,
				device.kind,
				on,
				typeof device.raw.subtype === "string" ? device.raw.subtype : "",
			),
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

/** Adjust a heater set point. p-api needs both spa and pool values together. */
export function useSetTemps(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.snapshot(serial ?? "-");
	return useMutation({
		mutationFn: ({ spa, pool }: { spa: string; pool: string }) =>
			setTemps(serial as string, spa, pool),
		onSettled: () => qc.invalidateQueries({ queryKey: qk }),
	});
}

/** Set a light's color effect. */
export function useLightColor(serial: string | undefined) {
	const qc = useQueryClient();
	const qk = keys.snapshot(serial ?? "-");
	return useMutation({
		mutationFn: ({
			name,
			subtype,
			effectId,
		}: {
			name: string;
			subtype: string;
			effectId: number;
		}) => setLightColor(serial as string, name, subtype, effectId),
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
		staleTime: 60_000,
		refetchOnWindowFocus: false,
		retry: false,
	});
}

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession, useSnapshot, useSystems } from "#/lib/queries";

/** Bounce to /login when there is no session. Every signed-in route uses this. */
export function useRequireSession() {
	const navigate = useNavigate();
	const session = useSession();

	useEffect(() => {
		if (!session.isPending && !session.data)
			navigate({ to: "/login", replace: true });
	}, [session.isPending, session.data, navigate]);

	return { pending: session.isPending, signedIn: Boolean(session.data) };
}

/**
 * Everything the pool and equipment screens derive from one snapshot. Both
 * routes call this; React Query serves the second from cache, so the split
 * costs no extra requests.
 */
export function usePool() {
	const systems = useSystems(true);
	const serial = systems.data?.[0]?.serial;
	const snap = useSnapshot(serial);

	const devices = snap.data?.devices ?? [];
	const byName = new Map(devices.map((d) => [d.name, d]));
	const pool = byName.get("pool_temp");
	const spa = byName.get("spa_temp");
	const spaMode = Boolean(spa?.value) && !pool?.value;
	// "Aux V3" and friends are unconfigured virtual slots the panel always
	// reports; hide them unless one is somehow on.
	const genericAux = /^aux\s+v\d+$/i;

	return {
		serial,
		snap,
		loading: systems.isPending || snap.isPending,
		spaMode,
		water: spaMode ? spa : pool,
		air: byName.get("air_temp"),
		poolSet: byName.get("pool_set_point"),
		spaSet: byName.get("spa_set_point"),
		heaters: devices.filter(
			(d) =>
				d.kind === "climate" &&
				d.name.endsWith("_heater") &&
				d.name !== "solar_heater",
		),
		light: devices.find((d) => d.kind === "light"),
		jetPump: byName.get("aux_2"),
		waterfall: byName.get("aux_1"),
		controls: devices.filter(
			(d) =>
				d.kind === "pump" ||
				d.name === "solar_heater" ||
				(["switch", "dimmer"].includes(d.kind) &&
					d.name !== "aux_1" &&
					d.name !== "aux_2" &&
					(d.on || !genericAux.test(d.label))),
		),
	};
}

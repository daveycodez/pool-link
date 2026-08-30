import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { isCelsius } from "#/lib/format";
import { useSession, useSnapshot } from "#/lib/queries";

/** Jandy LED WaterColors — the one light family with an effect list here. */
const JANDY_SUBTYPE = 4;

const num = (v: unknown) => (v == null ? Number.NaN : Number(v));

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
 * routes call this with the serial from the URL; React Query serves the
 * second from cache, so the split costs no extra requests.
 */
export function usePool(serial: string) {
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
		loading: snap.isPending,
		spaMode,
		celsius: isCelsius(snap.data?.raw),
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
		// A colour light is type 2; the subtype names the brand, which decides
		// what effect list applies. Only the Jandy family is implemented, so
		// anything else stays an ordinary switch rather than getting a hero
		// wired to effects it does not have.
		light: devices.find(
			(d) => d.kind === "light" && num(d.raw.subtype) === JANDY_SUBTYPE,
		),
		// The real spa-mode control: turning it on throws the valves over, which
		// is what makes the panel report spa_temp instead of pool_temp.
		spaPump: byName.get("spa_pump"),
		// Every aux relay the panel reports, in its own order. Nothing here is
		// named or positioned by this app — the pool screen renders one card
		// each, so a pool with different equipment gets different cards.
		auxes: devices.filter(
			(d) =>
				d.name.startsWith("aux_") &&
				d.kind !== "light" &&
				(d.on || !genericAux.test(d.label)),
		),
		// Equipment is the granular view: every actionable device the panel
		// exposes, including ones the pool screen surfaces its own way. Only the
		// unconfigured virtual slots are hidden, and only while they are off.
		controls: devices.filter(
			(d) =>
				(["pump", "switch", "dimmer", "light"].includes(d.kind) ||
					d.name === "solar_heater") &&
				(d.on || !genericAux.test(d.label)),
		),
	};
}

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { isCelsius } from "#/lib/format";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useSession, useSnapshot, useVspPumps } from "#/lib/queries";

/** Jandy LED WaterColors — the one light family with an effect list here. */
const JANDY_SUBTYPE = 4;

const num = (v: unknown) => (v == null ? Number.NaN : Number(v));

/**
 * Whether the panel reports this device at all. Fixed keys are always present
 * in the payload whether or not the hardware exists — an absent pool cover
 * comes back as "", not missing — so an empty state means "not installed"
 * rather than "off". Only the hero uses this; equipment shows everything the
 * panel names, installed or not.
 */
export function isReported(
	device: PoolDevice | undefined,
): device is PoolDevice {
	if (!device) return false;
	const state = device.raw.state ?? device.raw.status ?? device.raw.value;
	return state != null && String(state).trim() !== "";
}

/**
 * A colour light this app can actually drive. `type 2` means some colour
 * light; the subtype names the brand, and the brand decides which effect ids
 * apply. Anything else is left as a plain relay rather than given a hero wired
 * to effects it cannot run.
 */
export function isJandyLight(device: PoolDevice): boolean {
	return device.kind === "light" && num(device.raw.subtype) === JANDY_SUBTYPE;
}

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
	// Started here rather than inside the cards that need it, so the two run
	// together and the screen has everything before it draws anything.
	const pumps = useVspPumps(serial);

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
		// Both, so speed dropdowns arrive with their cards instead of after them.
		loading: snap.isPending || pumps.isPending,
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
		// The real spa-mode control: turning it on throws the valves over, which
		// is what makes the panel report spa_temp instead of pool_temp.
		spaPump: byName.get("spa_pump"),
		cover: byName.get("cover_pool"),
		// Every aux relay the panel reports, in its own order — lights included,
		// since the screen decides per relay which card to draw. Nothing here is
		// named or positioned by this app, so a pool with different equipment
		// gets different cards.
		auxes: devices.filter(
			(d) => d.name.startsWith("aux_") && (d.on || !genericAux.test(d.label)),
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

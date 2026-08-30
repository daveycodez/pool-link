import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { HPM_FAULTS, IaquaHeaterState } from "#/lib/aqualink/enums";
import { isCelsius } from "#/lib/format";
import type { PoolDevice } from "#/lib/iaqualink/types";
import {
	lastTemp,
	rememberTemp,
	usePanel,
	useSession,
	useSwc,
	useVspPumps,
} from "#/lib/queries";

/**
 * Relays to leave out of both screens, matched on the label the panel reports.
 *
 * Install-specific by nature — rename the relay and it comes back, and someone
 * else's relay of the same name would be hidden too. It is here because it was
 * asked for; the durable shape is a list the owner edits rather than one the
 * code carries.
 */
const HIDDEN_LABELS = new Set(["bomb karen"]);

/** Whether a device is one the screens should show at all. */
export function isHidden(device: { label: string }): boolean {
	return HIDDEN_LABELS.has(device.label.trim().toLowerCase());
}

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
 * Whether a heater is enabled but not firing.
 *
 * Heaters are the only equipment the panel reports three ways — 0 off, 1 on,
 * 3 enabled — and `heaterOn()` folds the last two into one boolean, because a
 * switch has two positions and both of those mean the heater is not off. The
 * distinction survives on the raw state and matters to anyone looking at the
 * card: a heater sitting in 3 all summer is waiting on a call for heat that a
 * pool already above its set point will never make, which is a different thing
 * from one that is burning.
 */
export function isStandby(device: PoolDevice | undefined): boolean {
	return (
		device?.kind === "climate" &&
		device.name.endsWith("_heater") &&
		String(device.raw.state) === IaquaHeaterState.ENABLED
	);
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
	const snap = usePanel(serial);
	// Started here so it runs with the panel rather than after the first paint;
	// the cards that use it read it through their own hook.
	const vsp = useVspPumps(serial);
	// Only fetched when the home screen reports a paired cell, so a panel
	// without one never sends the request at all — see useSwc.
	const saltCell = snap.data?.saltCell ?? null;
	const swc = useSwc(serial, Boolean(saltCell));

	const devices = snap.data?.devices ?? [];
	const byName = new Map(devices.map((d) => [d.name, d]));
	const pool = byName.get("pool_temp");
	const spa = byName.get("spa_temp");
	const spaPump = byName.get("spa_pump");
	/**
	 * The relay decides, not the readings. Spa mode is a valve position, and
	 * the switch that throws it answers at once — where the temperatures take
	 * the actuators' thirty seconds to catch up, and on a Combo panel may not
	 * swap at all. Inferring the mode from which body reported a number left
	 * the card saying Pool with the spa plainly running, and made a flip that
	 * should be instant wait on plumbing.
	 *
	 * The reading is allowed to lag: `water` is empty for those seconds and
	 * the hero shows a dash, which is the truth — no water is circulating
	 * through the spa yet.
	 */
	const spaMode = spaPump?.on === true;
	// Named for the body rather than the mode, so the two memories never cross.
	const bodyKey = spaMode ? "spa_temp" : "pool_temp";
	const liveTemp = (spaMode ? spa : pool)?.value ?? "";
	// In an effect rather than in the body: writing to storage while rendering
	// is a side effect, and this one is worth doing exactly once per reading.
	useEffect(() => {
		if (liveTemp) rememberTemp(serial, bodyKey, liveTemp);
	}, [serial, bodyKey, liveTemp]);

	// "Aux V3" and friends are unconfigured virtual slots the panel always
	// reports; hide them unless one is somehow on.
	const genericAux = /^aux\s+v\d+$/i;

	return {
		serial,
		snap,
		// Both, so speed dropdowns arrive with their cards instead of popping in
		// after the paint. The pumps are persisted, so this blocks only the
		// first visit ever — every later start restores them from IndexedDB
		// before the panel has even answered.
		loading: snap.isPending || vsp.isPending,
		spaMode,
		celsius: isCelsius(snap.data?.raw),
		water: spaMode ? spa : pool,
		/**
		 * What this body last read, for the seconds after a mode flip and the
		 * minutes after a panel goes quiet — null while a live reading exists,
		 * and null again once the remembered one is too old to mean anything.
		 */
		waterMemory: liveTemp ? null : lastTemp(serial, bodyKey),
		air: byName.get("air_temp"),
		poolSet: byName.get("pool_set_point"),
		spaSet: byName.get("spa_set_point"),
		poolChill: byName.get("pool_chill_set_point"),
		// Salinity is per body; ORP and pH are the water's, whichever is up.
		chem: {
			salinity: byName.get(spaMode ? "spa_salinity" : "pool_salinity"),
			orp: byName.get("orp"),
			ph: byName.get("ph"),
		},
		heaters: devices.filter(
			(d) =>
				d.kind === "climate" &&
				d.name.endsWith("_heater") &&
				d.name !== "solar_heater",
		),
		// Colour-light zones are their own subsystem, addressed by zone id and
		// never by an aux relay — so they sit apart from the device list.
		iclZones: snap.data?.icl ?? [],
		macros: snap.data?.macros ?? [],
		// When paired, this becomes the equipment that heats — so it changes how
		// set points are sent, not just what the equipment page lists.
		heatPump: snap.data?.heatPump ?? null,
		// Two halves of one thing, and they fail apart: the cell's presence and
		// live production come off the home screen every panel answers, while its
		// set points and boost timer come from a command no panel here has ever
		// been seen to accept. Null config with a non-null cell is the ordinary
		// case for a panel that rejects it, not an error state.
		saltCell,
		swc: swc.data ?? null,
		// The real spa-mode control: turning it on throws the valves over, which
		// is what makes the panel report spa_temp instead of pool_temp.
		spaPump,
		cover: byName.get("cover_pool"),
		// Kept out of `heaters` because it pairs with no body — it serves
		// whichever one is circulating, so the hero shows it alongside rather
		// than swapping it in and out.
		solar: byName.get("solar_heater"),
		// A mode, not a control: when it fires the panel runs equipment on its
		// own terms, which is worth saying rather than leaving unexplained.
		freezing: byName.get("freeze_protection")?.on === true,
		// Faults arrive only on a command's echo, never in get_home — so this is
		// set by acting on the pump, and cleared by the next poll.
		hpmFault: snap.data?.heatPump?.alert
			? (HPM_FAULTS[snap.data.heatPump.alert] ?? "Heat pump fault")
			: "",
		// Every aux relay the panel reports, in its own order — lights included,
		// since the screen decides per relay which card to draw. Nothing here is
		// named or positioned by this app, so a pool with different equipment
		// gets different cards.
		auxes: devices.filter(
			(d) =>
				d.name.startsWith("aux_") &&
				!isHidden(d) &&
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

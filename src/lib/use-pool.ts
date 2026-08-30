import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import {
	AUX_SUBTYPE_PADDED,
	AUX_TYPE_RELAY,
	HPM_FAULTS,
	IaquaHeaterState,
} from "#/lib/aqualink/enums";
import { presenceOf } from "#/lib/chemistry";
import { isCelsius } from "#/lib/format";
import type { PoolDevice, Raw } from "#/lib/iaqualink/types";
import {
	lastTemp,
	rememberTemp,
	usePanel,
	usePhOrp,
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
 *
 * The relay count that replaced the other label heuristic does not replace this
 * one. The relay it hides is `aux_EA`, which sits outside the addresses the
 * count measures, and the panel reports it the way it reports the three relays
 * that are really there — a type and subtype of 0, against the 2 every padded
 * slot carries, under a name its owner chose. It is a working relay somebody
 * asked not to look at, not a slot with nothing behind it, and nothing the
 * panel says would ever hide it.
 */
const HIDDEN_LABELS = new Set(["bomb karen"]);

/** Whether a device is one the screens should show at all. */
export function isHidden(device: { label: string }): boolean {
	return HIDDEN_LABELS.has(device.label.trim().toLowerCase());
}

/**
 * How many numbered relays the devices screen names before the banks begin.
 *
 * The numbered range is always aux_1 … aux_7 — an RS-8 (filter pump plus seven
 * auxiliaries) fills every one of them, and a panel bigger than that reaches
 * its remaining relays through expansion banks instead. The range does not
 * shrink for a smaller panel: this pool's RS-4 reports all seven, four of them
 * slots its hardware does not have.
 */
const BASE_AUX_SLOTS = 7;

/**
 * The expansion banks, in address order, and how many relays each holds.
 *
 * The panel's own labels are what fix this order. On this RS-4 every slot past
 * the hardware is named "Aux V1" through "Aux V28", and that sequence runs
 * unbroken from aux_4 to aux_7, on through aux_B1–B8, aux_C1–C8 and aux_D1–D8
 * — V5 lands exactly on aux_B1. So the banks are not a separate address space
 * to be judged on their own; they are the tail of the one the numbered slots
 * begin, and a relay's position in it can be counted straight through.
 */
const AUX_BANKS = ["B", "C", "D"];
const AUX_BANK_SIZE = 8;

/**
 * Where a relay sits in the panel's single ordered run of auxiliary addresses,
 * or null for an address that is not part of it.
 *
 * `aux_EA` is the null case and the reason this returns one: it is outside
 * both the numbered range and the banks, the count says nothing about it, and
 * on this pool it is a configured relay wearing an owner's name. An address
 * this cannot place is left for the caller to show, never to hide.
 */
function auxIndex(name: string): number | null {
	const numbered = /^aux_(\d+)$/.exec(name);
	if (numbered) return Number(numbered[1]);

	const banked = /^aux_([A-Z])(\d+)$/.exec(name);
	if (!banked) return null;
	const bank = AUX_BANKS.indexOf(banked[1]);
	const slot = Number(banked[2]);
	if (bank < 0 || slot < 1 || slot > AUX_BANK_SIZE) return null;
	return BASE_AUX_SLOTS + bank * AUX_BANK_SIZE + slot;
}

/**
 * The panel's own name for a slot it has no relay behind. The last thing asked
 * — see isWiredRelay — and fragile in exactly the way that made it worth
 * replacing: it is matched against a label the owner renames at the panel. It
 * is kept because it is the only question a panel that reports neither a relay
 * count nor a subtype can answer, and there is one of those in the wild.
 *
 * Deliberately narrow. "Aux3" and "Aux5" are the panel's default names for real
 * relays nobody has renamed, and both have been seen on relays that exist, so
 * only the V form counts.
 */
const GENERIC_AUX = /^aux\s+v\d+$/i;

/**
 * Whether the panel has hardware behind this relay.
 *
 * The devices screen is padded to a fixed width whatever the panel's size, so
 * most of what it names is nothing: this RS-4 reports 31 addressable relays for
 * the 3 it owns. Three things can say which, and they are asked in order of how
 * hard they are to argue with.
 *
 * `relay_count` first, because it is the hardware speaking. It is the number in
 * the panel's model name, the filter pump included, so the auxiliaries run from
 * index 1 to relayCount − 1 and every address past that is padding — whatever
 * it has been named. Captures from an RS-6 and two RS-4s all put the panel's
 * first padded slot at exactly that boundary, and AqualinkD builds its own
 * button list from panel size the same way, three auxiliaries at size 4 and
 * seven at size 8.
 *
 * Then `subtype`, because the count is often not sent at all — several panels
 * answer `relay_count` with an empty string, including an RS-4 that pads its
 * screen exactly like this one. A padded slot says `type` 0 and `subtype` 2,
 * and a real relay never says 2. This is nearly as good as the count and could
 * arguably lead; it is second only because it describes one slot where the
 * count describes the panel.
 *
 * The label last, and only when neither of those arrived.
 *
 * Every branch is answered generously — a device none of them can place is
 * shown — because a phantom row is a nuisance and a missing one is a relay the
 * owner cannot reach.
 */
export function isWiredRelay(
	device: { name: string; label: string; raw: Raw },
	relayCount: number | null,
): boolean {
	if (relayCount !== null) {
		const index = auxIndex(device.name);
		return index === null || index < relayCount;
	}
	if (
		num(device.raw.type) === AUX_TYPE_RELAY &&
		num(device.raw.subtype) === AUX_SUBTYPE_PADDED
	)
		return false;
	return !GENERIC_AUX.test(device.label);
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
	/**
	 * Whether the home screen put a number on either chemistry key. It is the
	 * gate on asking the probe about itself: a panel with nothing to say about
	 * pH or ORP has no reading on screen to qualify, so it never sends the
	 * request — see usePhOrp. Note that "0" passes this, deliberately. A zero is
	 * exactly the number worth doubting, and doubting it is what the query is
	 * for.
	 */
	const chemReported = Boolean(
		byName.get("ph")?.value || byName.get("orp")?.value,
	);
	const phorp = usePhOrp(serial, chemReported);
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

	// The devices screen is padded out to the largest panel the protocol can
	// address, so most of what it names is a slot with nothing behind it. The
	// panel's relay count says where its hardware stops; anything past that is
	// padding and stays off both screens — unless it is somehow on, which would
	// mean the count is wrong and a relay is running, and that is worth seeing.
	const relayCount = snap.data?.relayCount ?? null;
	const wired = (d: PoolDevice) => d.on || isWiredRelay(d, relayCount);

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
			/**
			 * What the probe says about each channel, so the row can tell a pad
			 * with no TruSense from one whose probe is fitted and not reading.
			 * Both stay `unknown` until the gated query answers, and `unknown`
			 * renders precisely as this app always has — nothing here can hide a
			 * reading on the strength of a request that never happened. Salt has
			 * no equivalent: the chlorinator reports its own presence on the home
			 * screen, so its reading needs no second opinion.
			 */
			phPresence: presenceOf(phorp.data?.phStatus),
			orpPresence: presenceOf(phorp.data?.orpStatus),
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
			(d) => d.name.startsWith("aux_") && !isHidden(d) && wired(d),
		),
		// Equipment is the granular view: every actionable device the panel
		// exposes, including ones the pool screen surfaces its own way. Only the
		// slots past the panel's relay count are hidden, and only while off.
		controls: devices.filter(
			(d) =>
				(["pump", "switch", "dimmer", "light"].includes(d.kind) ||
					d.name === "solar_heater") &&
				wired(d),
		),
	};
}

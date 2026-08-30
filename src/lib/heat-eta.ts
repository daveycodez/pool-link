/**
 * How much longer the water needs to reach its set point.
 *
 * The panel reports whole degrees, so differencing two readings measures where
 * in a staircase the window happened to open and close: flat across most of a
 * real degree, then a spike. No amount of smoothing recovers what is not in the
 * pair. The moment the integer changes is the only instant the panel says
 * anything exact, so this times those crossings and throws away the samples
 * between them — the error is then one poll per crossing however slowly the
 * water climbs, rather than a fraction of a degree however fast.
 *
 * The corollary is the whole design: the first reading of a session is not a
 * crossing. It sits at an unknown depth inside a plateau nobody watched begin,
 * so pairing it with the next crossing times a fraction of a degree as a whole
 * one and reads fast — the one direction the estimate must never err.
 *
 * The series lives at module scope rather than in the card because the card
 * unmounts on every trip to Equipment and back, and a measurement that started
 * over each time would never reach its third crossing. The reducer is pure and
 * takes plain objects, so a whole heat-up can be replayed through it from the
 * console without waiting for one.
 */
import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { tempRange } from "#/components/temp-stepper";
import { timeToGo } from "#/lib/format";
import type { HeatPump, PoolDevice } from "#/lib/iaqualink/types";
import { PAD_SETTLE_MS } from "#/lib/queries";

/** A reading the estimator kept: a whole-degree temperature, and when. */
export interface Step {
	temp: number;
	at: number;
}

export interface Run {
	/** `${serial}|${body}` — which system, and which body's sensor. */
	id: string;
	/** When this run was anchored, for withdrawing a seed that never earns out. */
	startedAt: number;
	/** The most recent accepted reading, crossing or not; the gap is timed
	 *  against this rather than against the last crossing, because a plateau
	 *  that is being watched is not a gap. */
	last: Step | null;
	/** The degree crossings, oldest first. Never the anchor. */
	steps: Step[];
}

export interface Sample {
	id: string;
	/** Already strict-parsed: NaN when the panel reported no reading. */
	temp: number;
	/** When the panel answered — `dataUpdatedAt`, not now. */
	at: number;
	/** The pad is mid-command, or has not settled from one. */
	busy: boolean;
	celsius: boolean;
}

/**
 * How far apart two readings may sit and still belong to one measurement.
 *
 * Polls land every ten seconds while the tab is visible, and the only
 * deliberate silences are the light holds, which run to about twenty seconds
 * with the pad's settle on the end. Ninety seconds is well past that, and past
 * the thirty at which the header stops calling the data live, so a gap this
 * wide means the tab was hidden — nothing polls in the background — or the
 * network was gone. Neither is data: the likeliest reason for a large rise
 * across an unwatched window is that the heat-up finished inside it and the
 * water has been cooling since, and a rate built from that counts down with
 * confidence toward a number the water is moving away from.
 */
const MAX_GAP_MS = 90_000;

/**
 * How much of the past a rate may be built from.
 *
 * A spa heat-up runs twenty to forty minutes and the rate is not constant
 * across it: heat loss grows with the gap to the air, and a heat pump's output
 * falls as the water warms. Twenty minutes is long enough to hold three
 * crossings from the slowest spa worth estimating — a degree every two minutes
 * — and short enough that the oldest crossing still describes roughly the same
 * physics as the newest.
 */
const RUN_WINDOW_MS = 20 * 60_000;

/**
 * At most this many crossings, so a fast spa cannot grow the series for as long
 * as the tab stays open. Eight is well past the three an estimate needs, and
 * anything quick enough to reach the cap spans so little time doing it that the
 * physics has not moved underneath the series.
 */
const MAX_STEPS = 8;

/**
 * Three crossings — two complete intervals — before a duration is shown.
 *
 * One interval carries a poll of error at each end, which is ±17% on a degree a
 * minute, and it rewrites itself visibly every time the next crossing lands.
 * That reads as a bug even though every number it printed was honest. Two
 * intervals halve the swing and cost about a minute of waiting on a spa.
 */
const MIN_STEPS = 3;

/**
 * The largest change between consecutive readings that could be water.
 *
 * This judges the step rather than the value on purpose. A pad transient prints
 * 0 for every temperature it reports, and 88 → 0 and 4 → 0 are both impossible
 * steps while only the first is an impossible value — a winterised pool in
 * Celsius really does read 2. The fastest spa heater worth naming moves about
 * 2°F a minute and readings are ten seconds apart, so two degrees is an order
 * of magnitude above the largest honest step. The one case it judges harshly is
 * a reading arriving at the far end of a near-90-second quiet stretch, where
 * that heater could genuinely have cleared two degrees; the run is then
 * discarded and re-anchored rather than poisoned, which costs a measurement and
 * cannot produce a wrong one.
 */
const MAX_STEP: Record<"F" | "C", number> = { F: 2, C: 1 };

/**
 * When silence means the water stopped climbing.
 *
 * The heater switch cannot be trusted to say so: `heaterOn()` counts raw state
 * "3" — enabled but not firing — as on, and a partner, a macro or the panel's
 * own schedule can stop the heat without this app hearing about it. The absence
 * of crossings is the tell. At two and a half times the cadence the crossings
 * have themselves been keeping, whatever was happening has stopped; the
 * 90-second floor keeps a fast spa, whose crossings are twenty seconds apart,
 * from dropping its estimate over a single late poll.
 */
const STALL_FACTOR = 2.5;
const STALL_FLOOR_MS = 90_000;

/**
 * How many systems' measurements to keep. A household watches one panel at a
 * time, so this exists only so that a Map at module scope has a ceiling; the
 * least recently sampled system is the one dropped.
 */
const MAX_RUNS = 8;

/**
 * Keyed by serial rather than by serial and body: one measurement per system is
 * alive at a time, and the body it belongs to is the run's own `id`. Which
 * means flipping to the spa and back does not park the pool's crossings and
 * hand them back — the water sat still while the valves were over, and those
 * minutes are in none of the timings.
 */
const runs = new Map<string, Run>();

/**
 * When the pad can be believed again. After any RS-485 command it reports every
 * temperature as 0 for a few seconds — the transient the light holds are built
 * around — and the readings inside that window are not about the water. Kept at
 * module scope rather than in a ref because the gesture that opens the window
 * is tapping Heat on this very card, and someone who then taps Equipment must
 * not walk back in to a clean slate.
 */
let padQuietUntil = 0;

/** Drop every measurement, for sign-out: the next account's water is not this
 *  one's, and a serial can be shared between accounts. */
export function clearHeatRuns(): void {
	runs.clear();
	padQuietUntil = 0;
}

/**
 * A number that could be a temperature of water, or NaN.
 *
 * The floor is the set-point range's own, so it holds in either scale: a
 * winterised pool in Celsius really does read 2, and the 0 a pad transient
 * prints is below both. Anything the panel is not reporting arrives here as 0
 * or NaN by whichever route — see the two callers — and 0 is the dangerous one,
 * because it is finite.
 */
function sane(n: number, celsius: boolean): number {
	return Number.isFinite(n) && n >= tempRange(celsius).min ? n : Number.NaN;
}

/**
 * A panel reading as a number, or NaN when there is not one.
 *
 * `value` is `string | null` — null for whichever body is not circulating — and
 * `Number(null)` is 0, which is finite and would pass every check downstream as
 * a reading of zero degrees, so a spa that is not on would print "102° to go".
 */
function reading(device: PoolDevice | undefined, celsius: boolean): number {
	const raw = device?.value?.trim();
	return sane(raw ? Number(raw) : Number.NaN, celsius);
}

/**
 * Fold one reading into the measurement. Pure, so a heat-up can be replayed
 * through it; every rejection returns the run it was handed, untouched.
 */
export function nextRun(prev: Run | undefined, sample: Sample): Run {
	const held: Run = prev ?? {
		id: sample.id,
		last: null,
		startedAt: sample.at,
		steps: [],
	};
	const step: Step = { temp: sample.temp, at: sample.at };

	// Before anything else, including the body: a transient blanks the whole
	// pad, and a blanked pool reading is exactly what makes spa mode look like
	// it flipped.
	if (sample.busy) return held;
	if (!Number.isFinite(sample.temp)) return held;

	// Keyed on the device name of the last accepted reading rather than on
	// `spaMode`, which is derived from which body reports a value and so flips
	// on its own when the pad reports "0" for the idle one.
	if (held.id !== sample.id)
		return { id: sample.id, last: step, startedAt: sample.at, steps: [] };

	const last = held.last;
	// The anchor: a reading at unknown depth in a plateau. It dates the run and
	// catches the first crossing, and it is never one end of a rate.
	if (!last) return { ...held, last: step };

	if (sample.at - last.at > MAX_GAP_MS)
		return { ...held, last: step, startedAt: sample.at, steps: [] };
	if (Math.abs(sample.temp - last.temp) > MAX_STEP[sample.celsius ? "C" : "F"])
		return held;
	if (sample.temp === last.temp) return { ...held, last: step };

	const steps = [...held.steps, step]
		.filter((s) => sample.at - s.at <= RUN_WINDOW_MS)
		.slice(-MAX_STEPS);
	return { ...held, last: step, steps };
}

/**
 * Degrees per millisecond, first crossing to last — the longest baseline the
 * window holds. Least squares is deliberately not used: it buys a little back
 * on poll quantisation while the dominant error is the real rate changing, and
 * it costs a function nobody can check by eye.
 */
export function heatRate(run: Run, now: number): number | null {
	if (run.steps.length < MIN_STEPS) return null;
	const first = run.steps[0];
	const last = run.steps[run.steps.length - 1];
	const span = last.at - first.at;
	if (span <= 0) return null;
	const mean = span / (run.steps.length - 1);
	if (now - last.at > Math.max(mean * STALL_FACTOR, STALL_FLOOR_MS))
		return null;
	return (last.temp - first.temp) / span;
}

/**
 * The rate memory, so a heat-up does not spend its first three minutes saying
 * how many degrees are left.
 *
 * This is the one thing here that outlives the tab, and it is a rate rather
 * than a reading on purpose: persist.ts refuses to restore readings because
 * one presented as current is a lie the app cannot detect, and a slope is a
 * property of the equipment against a body of water rather than a claim about
 * what the water is now. The degrees are still measured fresh every session;
 * only how fast they tend to arrive is remembered.
 */
const heatRateKey = (serial: string) => `pool-link:heat-rate-last:${serial}`;

/**
 * Rates worth believing, in degrees per minute.
 *
 * The ceiling is physical: a large gas heater on a small spa moves it about
 * two degrees a minute, so three is past anything a residential pad can do and
 * a stored value above it came from a mismeasurement rather than water. The
 * floor is about usefulness — under this even a small climb is most of a day
 * away, which is not an answer anybody acts on.
 */
const RATE_BAND: Record<"F" | "C", { min: number; max: number }> = {
	F: { min: 0.02, max: 3 },
	C: { min: 0.011, max: 1.7 },
};

/**
 * How long a remembered rate stands. A heat pump's output swings with the air
 * it is pulling from — half as much work in November as in July — and a cover
 * comes and goes across a season, so a fortnight is as far as one summer's
 * measurement describes the next fortnight's water.
 */
const RATE_MEMORY_MAX_AGE_MS = 14 * 24 * 60 * 60_000;

/**
 * Crossings before a run is worth remembering. Three is enough to show a
 * number, but four is a span no pair of unlucky polls can fake, and this one
 * is written down for next time.
 */
const TEACH_STEPS = 4;

/**
 * How long a remembered rate may speak for a climb that has not been seen to
 * climb. Three minutes is several crossings at any spa rate: see one and the
 * live measurement is on its way, see none and the heater is reporting itself
 * on without moving water — "3" means enabled, not firing — and last week's
 * rate is a guess wearing an answer's clothes.
 */
const SEED_GRACE_MS = 3 * 60_000;

interface RememberedRate {
	rate: number;
	at: number;
}

/** Both bodies and both kinds of heat, kept apart: a spa is a bathtub against
 *  a pool's tens of thousands of gallons, and a heat pump moves a fraction of
 *  what a burner does. One number for each combination, and no crossing over. */
export function heatSourceKey(
	body: string,
	heater: PoolDevice | undefined,
	heatPump: HeatPump | null,
	celsius: boolean,
): string {
	const source = heatPump?.on ? "hpm" : heater?.on ? "heater" : "";
	return source ? `${body}|${source}|${celsius ? "C" : "F"}` : "";
}

function readRates(serial: string): Record<string, RememberedRate> {
	try {
		return JSON.parse(localStorage.getItem(heatRateKey(serial)) ?? "{}");
	} catch {
		return {};
	}
}

/**
 * Teach the memory: the newest measurement replaces what was there.
 *
 * Not an average with the old one. Tomorrow's heat-up is most like today's —
 * same water, same equipment, near enough the same air — and least like one
 * from a fortnight ago under a cover that has since come off. Averaging would
 * hold onto conditions that have already gone, and it would take several runs
 * to walk back from a heater swapped for a heat pump instead of one. The cost
 * is that a single badly-timed run misleads the next one, and the next one
 * then corrects it outright.
 */
export function rememberHeatRate(serial: string, key: string, rate: number) {
	if (!serial || !key) return;
	try {
		localStorage.setItem(
			heatRateKey(serial),
			JSON.stringify({
				...readRates(serial),
				[key]: { at: Date.now(), rate },
			}),
		);
	} catch {
		// No storage; every heat-up simply measures itself from scratch.
	}
}

/** The remembered rate, in degrees per millisecond, or null. */
export function lastHeatRate(
	serial: string,
	key: string,
	celsius: boolean,
): number | null {
	if (!serial || !key) return null;
	const one = readRates(serial)[key];
	if (typeof one?.rate !== "number" || typeof one?.at !== "number") return null;
	if (Date.now() - one.at > RATE_MEMORY_MAX_AGE_MS) return null;
	const band = RATE_BAND[celsius ? "C" : "F"];
	const perMinute = one.rate * 60_000;
	if (perMinute < band.min || perMinute > band.max) return null;
	return one.rate;
}

/**
 * How close to the set point stops being a countdown and starts being upkeep.
 *
 * Two degrees, because that is the band a spa lives in while someone is in it:
 * the water sheds heat to the air and the panel catches it, so the reading
 * sits a degree or two under the target for the whole soak. Nothing there
 * wants a number — the answer to "how much longer" is that it is already warm
 * and the heater is keeping it there.
 */
const HEATING_ONLY_DEGREES = 2;

/**
 * The line, from a rate and the two temperatures. The rate is a single input so
 * that a measured-last-time rate, if one is ever remembered, slots in here
 * without any of this changing.
 */
export function heatCaption(
	rate: number | null,
	current: number,
	target: number,
): string {
	if (!Number.isFinite(current) || !Number.isFinite(target)) return "";
	const remaining = target - current;
	// Printed because the panel's own reading arrived, never because a countdown
	// expired: heaters approach the last degree asymptotically and plenty of
	// installs cut out short of the number, so a timer reaching zero is a fact
	// about arithmetic rather than about water.
	//
	// And only when a rate says we watched it climb. Water sitting above its set
	// point is the ordinary state of a warm pool in summer, not an arrival — the
	// heater reports "enabled" all season next to it, so announcing readiness on
	// the arithmetic alone would park the word on the card until October.
	if (remaining <= 0) return rate === null ? "" : "Ready";
	// Inside a couple of degrees there is nothing worth counting. A spa in use
	// drifts a degree or two under its set point and the heater catches it back
	// up, over and over — a duration there would be a countdown to a number the
	// water is already at for practical purposes, restarting every few minutes.
	// It only needs to say that the heat is on, which is also true of the last
	// stretch of a real heat-up, where the approach goes asymptotic and any
	// estimate is at its worst.
	if (remaining <= HEATING_ONLY_DEGREES) return "Heating";
	if (rate === null) return `${Math.round(remaining)}° to go`;
	// A rate pointing away from the target is a heat-up that has already ended.
	if (rate <= 0) return "";
	return timeToGo(remaining / rate);
}

/**
 * The caption for the pool/spa hero, empty when there is nothing honest to say.
 *
 * Everything is timed against `updatedAt`, so nothing here runs on an interval:
 * a ticker would re-render the switch stack and the stepper six times a minute
 * for a line that only changes when a poll lands, and a clock that stops
 * because polls stopped overstates the wait, which is the safe direction.
 */
export function useHeatEta({
	serial,
	water,
	target,
	celsius,
	updatedAt,
	heater,
	heatPump,
	freezing,
}: {
	serial: string;
	water: PoolDevice | undefined;
	target: number;
	celsius: boolean;
	updatedAt: number;
	heater: PoolDevice | undefined;
	heatPump: HeatPump | null;
	freezing: boolean;
}): string {
	// Every mutation, not just this panel's: the pad answers for the whole
	// system, so a command to any part of it blanks the temperatures.
	const commanding = useIsMutating() > 0;

	// The window opens on the way out of a command rather than on the way in,
	// because that is when the pad starts settling — while one is in flight
	// `commanding` is already refusing everything.
	useEffect(() => {
		if (!commanding) return;
		return () => {
			padQuietUntil = Date.now() + PAD_SETTLE_MS;
		};
	}, [commanding]);

	// Nothing is worth saying unless something is heating this water. Solar
	// alone is deliberately not enough: an estimate driven by insolation is a
	// weather forecast. Chill counts toward pool_chill_set_point, which is a
	// different number from the one on the card. And under freeze protection the
	// panel is running the equipment on its own terms.
	const firing = heater?.on === true && heatPump?.mode !== "chill" && !freezing;
	const body = water?.name ?? "";
	const temp = reading(water, celsius);

	const run = useMemo(() => {
		if (!serial || !body || !updatedAt || !firing) return null;
		const next = nextRun(runs.get(serial), {
			id: `${serial}|${body}`,
			temp,
			at: updatedAt,
			busy: commanding || Date.now() < padQuietUntil,
			celsius,
		});
		// Re-inserted rather than overwritten, so the Map's own order is least
		// recently sampled first — which is the order the bound evicts in.
		runs.delete(serial);
		runs.set(serial, next);
		if (runs.size > MAX_RUNS) {
			const oldest = runs.keys().next().value;
			if (oldest !== undefined) runs.delete(oldest);
		}
		return next;
	}, [serial, body, temp, updatedAt, celsius, commanding, firing]);

	const live = run ? heatRate(run, updatedAt) : null;
	const memoryKey = heatSourceKey(body, heater, heatPump, celsius);

	// Written down once a run has measured enough to be worth repeating. In an
	// effect because it writes to storage, and keyed on the rate so a run that
	// keeps crossing does not keep re-teaching from the same climb.
	const teachable =
		run && run.steps.length >= TEACH_STEPS && live !== null ? live : null;
	useEffect(() => {
		if (teachable !== null) rememberHeatRate(serial, memoryKey, teachable);
	}, [serial, memoryKey, teachable]);

	if (!run) return "";
	// Last time's rate stands in until this time's is measured — which is the
	// first three minutes, and the three minutes somebody is most likely to be
	// looking. Withdrawn once a climb has gone that long without a single
	// crossing: the heater is reporting itself on without moving water, and a
	// remembered rate would be answering for a heat-up that is not happening.
	const stalled =
		run.steps.length === 0 && updatedAt - run.startedAt >= SEED_GRACE_MS;
	const rate =
		live ?? (stalled ? null : lastHeatRate(serial, memoryKey, celsius));

	// The target arrives already through a bare `Number()`, which is 0 for the
	// empty string a panel sends for a set point it does not have — and counting
	// down to zero degrees would report every warm pool as ready.
	return heatCaption(rate, temp, sane(target, celsius));
}

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
import { aboutHowLong } from "#/lib/format";
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
	const held: Run = prev ?? { id: sample.id, last: null, steps: [] };
	const step: Step = { temp: sample.temp, at: sample.at };

	// Before anything else, including the body: a transient blanks the whole
	// pad, and a blanked pool reading is exactly what makes spa mode look like
	// it flipped.
	if (sample.busy) return held;
	if (!Number.isFinite(sample.temp)) return held;

	// Keyed on the device name of the last accepted reading rather than on
	// `spaMode`, which is derived from which body reports a value and so flips
	// on its own when the pad reports "0" for the idle one.
	if (held.id !== sample.id) return { id: sample.id, last: step, steps: [] };

	const last = held.last;
	// The anchor: a reading at unknown depth in a plateau. It dates the run and
	// catches the first crossing, and it is never one end of a rate.
	if (!last) return { ...held, last: step };

	if (sample.at - last.at > MAX_GAP_MS)
		return { ...held, last: step, steps: [] };
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
 * Below this the caption stops counting and says so in words. Five minutes is
 * inside the estimate's own error, so "about 5 min" would be arithmetic dressed
 * as a promise — and it is about how long it takes to walk outside and get in,
 * which is the decision this line exists to inform.
 */
const ALMOST_MS = 5 * 60_000;

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
	if (remaining <= 0) return "Ready";
	if (remaining <= 1) return "almost ready";
	if (rate === null) return `${Math.round(remaining)}° to go`;
	// A rate pointing away from the target is a heat-up that has already ended.
	if (rate <= 0) return "";
	const ms = remaining / rate;
	return ms < ALMOST_MS ? "almost ready" : aboutHowLong(ms);
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

	if (!run) return "";
	// The target arrives already through a bare `Number()`, which is 0 for the
	// empty string a panel sends for a set point it does not have — and counting
	// down to zero degrees would report every warm pool as ready.
	return heatCaption(heatRate(run, updatedAt), temp, sane(target, celsius));
}

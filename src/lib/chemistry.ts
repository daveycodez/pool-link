/**
 * Whether a chemistry probe is fitted, and whether the number beside it is a
 * measurement or a placeholder.
 *
 * `get_home` reports `ph` and `orp` as bare strings and says nothing about the
 * hardware behind them. A pad with no TruSense sends empty strings; a probe
 * that is fitted but not reading sends a zero. Downstream those are the only
 * two things the app has ever had, and neither one carries the fact that
 * decides how to render it — so a pH of 0, which is a molar acid rather than
 * water, painted as a real reading in alarm red.
 *
 * `get_phorp_values` is the missing half. It answers with a per-channel status
 * string alongside the values, and that string is the panel's own word on
 * whether a probe exists. This module owns the vocabulary for it and the rule
 * for reading it, so the query layer and the row that renders never have to
 * guess at either.
 */
import { getPhOrpValues, type PhOrpReading } from "#/lib/aqualink/client";

/**
 * What the panel will say about a probe, once it has been asked.
 *
 * `unknown` is not a failure mode to be tidied away — it is the state every
 * panel is in before the question is worth asking, and the state one stays in
 * when the command is rejected or the field comes back blank. It has to mean
 * "carry on as before", because the alternative is an app that hides a real
 * reading on the strength of a request that did not happen.
 */
export type ChemPresence = "absent" | "present" | "unknown";

/**
 * The only sensor status ever observed from a live panel, in lower case.
 *
 * This pool has no TruSense and both channels answer `"Absent"`, which is a
 * single data point saying what a missing probe looks like and nothing at all
 * about what a fitted one says. No capture, protocol reference or third-party
 * client anywhere names the other side of the pair — iaqualink-py's reference
 * documents both fields as "sensor operational status" and declines to
 * enumerate them, and no client calls the command at all — so guessing at
 * `"Present"` or `"Ok"` and matching against it would leave every real probe
 * unrecognised and its readings suppressed, which is a far worse failure than
 * the one this fixes. Presence is therefore decided by not matching this word,
 * and the unknown vocabulary stays on the safe side of the test.
 *
 * Compared case-insensitively, which is not fussiness. The same reference
 * spells every other presence flag on this API in lower case — `is_icl_present`
 * and `zoneStatus` both answer `"present"` and `"absent"` — while this panel
 * answered `"Absent"` with a capital. The API is inconsistent about it, so the
 * comparison cannot afford to care.
 */
const ABSENT_STATUS = "absent";

/**
 * Read one channel's status string as a verdict.
 *
 * A blank is `unknown` rather than `present`: `getPhOrpValues` reports an
 * empty string when the field is missing entirely, which is what a panel that
 * does not implement this command looks like, and that panel's `get_home`
 * readings must go on rendering exactly as they did before.
 *
 * So is a bare number, for the same reason and a sharper one. Presence is
 * decided by not matching a word, which quietly reads anything unrecognised as
 * a fitted probe — and a panel that answered this field numerically would have
 * every channel declared present on the strength of a `0`. A number is not in
 * this vocabulary; the only field ever observed here holds a word. Refusing to
 * interpret one keeps the failure on the side that changes nothing.
 */
export function presenceOf(status: string | undefined): ChemPresence {
	const word = status?.trim().toLowerCase() ?? "";
	if (!word || Number.isFinite(Number(word))) return "unknown";
	return word === ABSENT_STATUS ? "absent" : "present";
}

/**
 * Whether a fitted probe's reading is a measurement or its way of saying
 * nothing.
 *
 * Zero is not a plausible value on either channel. A pool's pH sits between 7
 * and 8 and water itself cannot go below about 4 without being something other
 * than pool water; pH 0 is a one-molar strong acid. ORP is a millivolt
 * potential that runs in the hundreds even in badly neglected water, and a
 * sanitised pool reads 650-750. So a zero from a probe the panel says is
 * fitted is the probe reporting no measurement — dry, disconnected at the
 * cell, or never calibrated — and the honest thing to show is that it is not
 * reading, not a number that would be an emergency if it were true.
 *
 * AqualinkD reaches the same conclusion from the other end of the wire. It
 * reads these two off the RS-485 bus rather than the cloud, guards every
 * assignment with `orp > 0 && ph > 0` and logs a parse failure otherwise, and
 * holds both at a -999 sentinel until a real reading lands — a zero never
 * becomes a value there at all. Its own UI blanks the tile on zero. Two
 * independent paths to the panel agreeing that this number is the absence of a
 * measurement is the strongest evidence available short of owning the hardware.
 *
 * Only exact zero is treated this way. A drifted probe reporting an
 * implausible-but-nonzero value is still making a measurement, and second-
 * guessing it here would hide the very reading that tells the owner something
 * is wrong.
 *
 * An empty string is not a zero, whatever `Number("")` says. Callers filter
 * blanks out before reaching here, so this is a guard rather than a live path
 * — but a helper that answers "yes, that is a zero reading" for the absence of
 * any reading at all is a trap set for whoever calls it next.
 */
export function isBlankReading(value: string): boolean {
	if (!value.trim()) return false;
	const n = Number(value);
	return Number.isFinite(n) && n === 0;
}

/**
 * Which sensor unit to ask, in the order to ask it.
 *
 * `unit_id` is documented as an integer and nothing further — iaqualink-py's
 * protocol reference admits it has never seen a live value, and no capture
 * anywhere names a valid range. What this pad answered is openly contradictory:
 * `get_phorp_values` returned 200 for both 0 and 1 with byte-identical bodies
 * and echoed no unit id back at all, while the two calibration commands beside
 * it rejected 0 outright, accepted 1, and then disagreed with each other about
 * which id they had been given. Nothing in that supports picking one and
 * committing to it.
 *
 * So 1 leads, as the only id anything on this pad has ever accepted, and 0
 * follows because half the evidence says it is legal too and a panel that
 * wants it should not be permanently unreadable over a coin flip. The list
 * stops at two because every id past the evidence is a rejected request per
 * gated panel per cycle, bought with nothing but a guess.
 */
export const PHORP_UNIT_IDS = [1, 0] as const;

/**
 * Ask the probe about itself, trying each plausible unit id in turn.
 *
 * The first id to answer wins and the rest are never sent, so the ordinary
 * case is one request. Failures are swallowed only to move on to the next id;
 * if none answers the last error is rethrown, which leaves the query in error
 * and every channel at `unknown` — the panel's `get_home` readings then render
 * as they always have.
 */
export async function readPhOrp(serial: string): Promise<PhOrpReading> {
	let last: unknown;
	for (const unitId of PHORP_UNIT_IDS) {
		try {
			return await getPhOrpValues(serial, unitId);
		} catch (error) {
			last = error;
		}
	}
	throw last;
}

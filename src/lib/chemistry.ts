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
import {
	getPhOrpCalibrationStatus,
	getPhOrpLastCalibration,
	getPhOrpValues,
	type PhOrpReading,
} from "#/lib/aqualink/client";
import type { Raw } from "#/lib/aqualink/types";

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

/**
 * When each channel was last calibrated, and whether one is being calibrated
 * right now.
 *
 * Calibration is the other half of the question `presenceOf` answers. Presence
 * says a probe is fitted; this says whether anyone has ever told it what the
 * water is. An uncalibrated probe reports a number with exactly the confidence
 * of a calibrated one, and a probe calibrated three summers ago reports a number
 * that has been drifting the whole time — neither fact is anywhere in `get_home`
 * or in `get_phorp_values`.
 */
export interface PhOrpCalibration {
	/**
	 * The unit id the panel actually answered on.
	 *
	 * Carried out of the read because it is the only defensible input to a
	 * calibration write. `unit_id` has no documented range and this pad rejects 0
	 * outright on both calibration reads, so a write that picked an id on its own
	 * would be guessing at which physical sensor to rewrite. Instead the id is
	 * whatever the panel just proved it accepts, and a panel that answers no id at
	 * all leaves the query in error and offers no calibration controls.
	 */
	unitId: number;
	phCalibrated: boolean;
	/** Null where the panel reports no date, or one this cannot read. */
	phCalibratedAt: Date | null;
	orpCalibrated: boolean;
	orpCalibratedAt: Date | null;
	/**
	 * The panel's word for a calibration in progress, verbatim and upper-cased.
	 * Empty when it did not say — which includes every panel that rejects the
	 * command that reports it.
	 */
	status: string;
}

/**
 * The only calibration status ever observed, and it means nothing is happening.
 *
 * Read the same way `ABSENT_STATUS` is, and for the same reason: one live value
 * is all anyone has, so the vocabulary can only be defined by what it is not.
 * The direction is reversed, though, and deliberately. Presence decides
 * "present" by *not* matching, because suppressing a real reading is the worse
 * error; this decides "busy" by not matching, because the worse error is
 * offering to start a second calibration on a probe already in the middle of
 * one.
 *
 * The cost of that choice is stated rather than hidden: if a panel reports a
 * terminal word here — "SUCCESS", "FAILED", something this has never seen — it
 * reads as busy and the calibration buttons stay disabled until it clears. That
 * is a control this app never had until today going missing, which is the same
 * place every other unknown in this module lands.
 */
const IDLE_CALIBRATION_STATUS = "NOSTATUS";

/**
 * Whether the panel says a calibration is under way.
 *
 * Normalises rather than trusting its caller, for the reason `presenceOf` gives:
 * this API spells `is_icl_present` and `zoneStatus` in lower case and answered
 * `pH_sensor_status` with a capital, so nothing about its casing can be relied
 * on. `readPhOrpCalibration` already upper-cases what it stores — that is for
 * the caption, which shows the word — and this must not quietly depend on it.
 */
export function isCalibrating(status: string): boolean {
	const word = status.trim().toUpperCase();
	return word !== "" && word !== IDLE_CALIBRATION_STATUS;
}

/**
 * The bounds on the reference pH an operator may hand a one-point calibration.
 *
 * The number is a measurement of pool water, not a buffer, and Jandy's TruSense
 * owner's manual is unambiguous about it: the one-point procedure is fill a
 * clean non-metal container with pool water, measure its pH, enter that reading,
 * then submerge the sensor in that same sample and start. Buffer solutions
 * belong to the two-point procedure, which uses pH 7 and pH 4 and which this app
 * does not offer. So the range is pool chemistry and nothing wider.
 *
 * These bounds are a little looser than the only comparable published number —
 * Goose66's ISY driver bounds a displayed pool pH at 6.8 to 8.4 — because that
 * one describes water somebody is happy with, and a probe being calibrated
 * frequently sits on a pool somebody is not. They stop well short of the
 * buffers: entering 4.0 here would be the two-point procedure's number arriving
 * in the one-point command, which does not calibrate the probe, it teaches it
 * that ordinary pool water is a thousand times more acidic than it is. No panel
 * limit is documented — the manual only says the sensor reports nothing at all
 * above pH 12 — so this bound is entirely this app's, and it exists because the
 * command has no undo.
 *
 * A tenth is the step because no pool test does better. A drop kit resolves to
 * about 0.2 by eye, a decent photometer to 0.1, and a hundredth would invite a
 * precision nobody standing at a pool has. It is also the precision Goose66's
 * driver settled on for the same reading.
 *
 * Sent as a decimal, not as the tenths integer `get_home` uses. That scaling —
 * pH × 0.1, ORP × 10, salt × 50 — belongs to the packed home frame, and the two
 * publications that name this command's parameter and this probe's own reading
 * both type them in native units. Sending 74 for pH 7.4 would be carrying a
 * quirk of one screen into a command that never had it.
 */
export const PH_REFERENCE = { min: 6, max: 9, step: 0.1 } as const;

/** A whole number from a wire field, or null when the field is not one. */
const int = (v: unknown): number | null => {
	if (v === "" || v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * The earliest year a calibration date can plausibly carry.
 *
 * A TruSense is a controller accessory of the last decade or so, and this app
 * only ever reads a date the panel wrote when someone calibrated. So a year
 * below this is not an old calibration, it is a field this code has misread —
 * and the honest rendering of a misread date is no date at all.
 */
const EARLIEST_CALIBRATION_YEAR = 2000;

/**
 * One `{year, month, day}` object as a date, or null when it is not one.
 *
 * The all-zero form is what an uncalibrated channel sends and it is the only
 * form this pad has ever produced, so every other shape here is inference. Two
 * encodings are accepted: a full year, and a two-digit year expanded through
 * 2000, which is the only other way a calendar year fits a field beside a
 * one-based month and day. Anything else — a month of 0 or 13, a day of 32, a
 * year this cannot place — is refused rather than coerced, and the channel then
 * renders as calibrated with no age instead of as calibrated in 1970.
 *
 * The month is one-based on the wire and zero-based in the constructor, which is
 * the trap this exists to contain.
 */
function calibrationDate(value: unknown): Date | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Raw;
	const year = int(raw.year);
	const month = int(raw.month);
	const day = int(raw.day);
	if (year === null || month === null || day === null) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const full = year > 0 && year < 100 ? 2000 + year : year;
	if (full < EARLIEST_CALIBRATION_YEAR) return null;
	const date = new Date(full, month - 1, day);
	// A day the month does not have — 31 April — rolls forward silently, which
	// would report a calibration on a date that did not happen.
	return date.getMonth() === month - 1 ? date : null;
}

/** The panel answers "yes"/"no"; anything else is not a yes. */
const isYes = (v: unknown): boolean =>
	String(v ?? "")
		.trim()
		.toLowerCase() === "yes";

/**
 * Read one panel's calibration state, over the two commands that report it.
 *
 * `get_phorp_lastcalibinfo` leads and is the only one allowed to fail the read.
 * It is the authority on the dates for a specific reason: asked for unit 1 it
 * echoes `"unit_id": 1`, where `get_phorp_calibstatus` asked for the same 1
 * echoes `"unit_id": 0`. The two bodies are otherwise the same fields, so one of
 * them is answering about a unit nobody asked about — and the one that can name
 * the unit it answered for is the one to believe about that unit's history.
 *
 * `get_phorp_calibstatus` is then asked for the one field only it carries, the
 * in-progress status, and is allowed to fail. Its dates are read and discarded
 * on the reasoning above. A panel that rejects it leaves the status empty, which
 * reads as "not known to be busy" rather than as idle — the distinction matters
 * to the caller and not to this function.
 *
 * Both are asked with the same unit id, and that id is carried out in the result
 * so a calibration write never has to invent one.
 */
export async function readPhOrpCalibration(
	serial: string,
): Promise<PhOrpCalibration> {
	let last: unknown;
	for (const unitId of PHORP_UNIT_IDS) {
		let info: Raw;
		try {
			info = await getPhOrpLastCalibration(serial, unitId);
		} catch (error) {
			last = error;
			continue;
		}
		const status = await getPhOrpCalibrationStatus(serial, unitId).catch(
			() => null,
		);
		return {
			unitId,
			phCalibrated: isYes(info.is_pH_calibrated),
			phCalibratedAt: calibrationDate(info.pH_calibration_date),
			orpCalibrated: isYes(info.is_ORP_calibrated),
			orpCalibratedAt: calibrationDate(info.ORP_calibration_date),
			status: String(status?.pHORP_Calibration_Status ?? "")
				.trim()
				.toUpperCase(),
		};
	}
	throw last;
}

/** Days per month and per year, for the age below. Averages, not calendars. */
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365.25;

/**
 * How long ago a calibration was, in the coarsest unit that is still true.
 *
 * Deliberately vague past a month, because the number is a maintenance prompt
 * rather than a record. What an owner does with "8 months ago" is decide whether
 * to go and recalibrate; nothing about that decision changes between 240 days
 * and 247, and printing the exact day count would dress a rounded month up as
 * precision the app cannot back — the date arrives with no time of day on it,
 * from a panel clock nobody has checked against anything.
 *
 * A future date reads as today rather than as a negative age. Panel clocks are
 * set by hand and drift, and "calibrated in 3 days" is a sentence about this
 * app's arithmetic rather than about the pool.
 */
export function calibrationAge(at: Date, now: Date = new Date()): string {
	const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < DAYS_PER_MONTH) return `${days} days ago`;
	// The handover is on the rounded month rather than on a day count, so a year
	// exactly reads as a year: comparing days against 365.25 first left the
	// 365th day rounding to twelve months and printing "12 months ago".
	const months = Math.round(days / DAYS_PER_MONTH);
	if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
	const years = Math.round(days / DAYS_PER_YEAR);
	return years === 1 ? "1 year ago" : `${years} years ago`;
}

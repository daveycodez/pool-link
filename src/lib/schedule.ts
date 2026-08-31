/**
 * The vocabulary and formatting for the panel's own timed programs.
 *
 * Its own module rather than a corner of a route file because two things need
 * it — the list rows and the editor — and because the day vocabulary is the
 * part of this feature that had to be measured rather than read. Keeping it
 * here puts the evidence next to the values it justifies.
 */

/**
 * Every value the panel's `scheduleDays` field takes, in the order the panel's
 * own PROGRAM menu offers them.
 *
 * This is a closed enum, not a day mask, and that distinction is the whole
 * reason this list is spelled out. The protocol reference this app was ported
 * from describes the field only as a "days descriptor (e.g. `All Days`)", which
 * is wrong twice over: the wire value has no space in it, and the field can
 * never name more than one day. The Jandy AquaLink RS manual settles the shape
 * — equipment runs "all days, weekends, weekdays, or any specific day of the
 * week" — so a picker offering a row of day checkboxes would be describing a
 * schedule the panel cannot hold.
 *
 * The panel also echoes its own raw bytes alongside the JSON, and the day byte
 * there is a flat 1-based index into exactly this order: Sunday is 1, Saturday
 * is 7, then AllDays 8, Weekends 9, Weekdays 10. Four of those were seen on the
 * wire from this pool — AllDays (8), Weekends (9), Weekdays (10) and Wednesday
 * (4) — and Wednesday landing on 4 is what fixes the week as Sunday-first.
 *
 * The other six day names are inferred from that anchor rather than observed.
 * They are spelled in full because Wednesday was, and they sit where a
 * Sunday-first week puts them. This is the least certain thing in the feature
 * and it writes to real hardware: confirming one of them costs one schedule set
 * from the official app and one re-read.
 */
export const SCHEDULE_DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"AllDays",
	"Weekends",
	"Weekdays",
] as const;

export type ScheduleDays = (typeof SCHEDULE_DAYS)[number];

/** The panel's default, and the only value this pool had before it was probed. */
export const DEFAULT_SCHEDULE_DAYS: ScheduleDays = "AllDays";

/**
 * Whether a string the panel reported is one this app knows how to offer back.
 *
 * A schedule set from the panel's own keypad could name a day spelled some way
 * nobody here has seen. Such a schedule still lists and still has its times
 * edited; what it must not do is get silently rewritten to a value it did not
 * have, so the editor keeps an unrecognised string as-is instead of snapping it
 * to the nearest known one.
 */
export function isKnownDays(days: string): days is ScheduleDays {
	return (SCHEDULE_DAYS as readonly string[]).includes(days);
}

const DAY_LABELS: Record<ScheduleDays, string> = {
	AllDays: "Every day",
	Weekdays: "Weekdays",
	Weekends: "Weekends",
	// Plural because a schedule recurs: "Wednesday" reads like a date, and this
	// runs every Wednesday until somebody deletes it.
	Sunday: "Sundays",
	Monday: "Mondays",
	Tuesday: "Tuesdays",
	Wednesday: "Wednesdays",
	Thursday: "Thursdays",
	Friday: "Fridays",
	Saturday: "Saturdays",
};

/** How a days value is written on screen. Unknown values are shown verbatim. */
export function dayLabel(days: string): string {
	return isKnownDays(days) ? DAY_LABELS[days] : days;
}

/**
 * A wall-clock time as the pad's owner reads it.
 *
 * Twelve-hour with a meridiem, matching the official app and the panel's own
 * keypad. Hand-rolled rather than taken from `Intl`, because the app carries no
 * locale machinery at all — the one `lang` it declares is "en", every label in
 * it is an English literal, and a formatter that quietly followed the browser's
 * locale would be the only thing here that did.
 */
export function formatClock(hrs: number, mins: number): string {
	const meridiem = hrs < 12 ? "AM" : "PM";
	// Midnight and noon are both 12 on a 12-hour clock, from opposite ends.
	const hour = hrs % 12 === 0 ? 12 : hrs % 12;
	return `${hour}:${String(mins).padStart(2, "0")} ${meridiem}`;
}

/** Minutes since midnight, which is what makes two times comparable. */
export function minutesOfDay(hrs: number, mins: number): number {
	return hrs * 60 + mins;
}

/**
 * Whether a window runs past midnight into the next day.
 *
 * Worth its own answer rather than being left for the reader to notice. The
 * schedule that started all of this ran 4PM to 4AM, and read as a plain pair of
 * times it looks like a twelve-hour window sitting inside one afternoon — which
 * is exactly the misreading that made equipment turning itself back on at night
 * inexplicable. A stop that lands on the start is a zero-length window rather
 * than a full day, so it is not counted here.
 */
export function isOvernight(
	startHrs: number,
	startMins: number,
	stopHrs: number,
	stopMins: number,
): boolean {
	return minutesOfDay(stopHrs, stopMins) < minutesOfDay(startHrs, startMins);
}

/** "4:00 PM – 4:00 AM", en dash, as one phrase for a row's description. */
export function windowLabel(
	startHrs: number,
	startMins: number,
	stopHrs: number,
	stopMins: number,
): string {
	return `${formatClock(startHrs, startMins)} – ${formatClock(stopHrs, stopMins)}`;
}

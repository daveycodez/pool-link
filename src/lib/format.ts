/** Compact relative time for the header chip: "12s ago", "3m ago", "2h ago". */
export function timeAgo(at: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - at) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

/**
 * The forward-looking sibling of timeAgo, for the heat-up chip: "25m to go".
 * Its own function because timeAgo is past tense to the bone — it hard codes
 * " ago" and clamps a future instant to "0s ago".
 *
 * Phrased to match the degree count it alternates with, since they answer the
 * same question a few minutes apart and reading as one sentence matters more
 * than either reading well alone.
 *
 * Rounded up, never to nearest, because the two errors are not the same size:
 * arriving to water already warm costs nothing, and walking outside to a cold
 * spa because the line ran out is the failure that leaves the estimate worth
 * less than no estimate. Five-minute steps for the reason it names a duration
 * rather than a clock time — it is worth about ±25%, and a number ending in a
 * 7 invites a precision it does not have.
 */
export function timeToGo(ms: number): string {
	const m = Math.max(5, Math.ceil(ms / 300_000) * 5);
	if (m < 60) return `${m}m to go`;
	const h = Math.floor(m / 60);
	const rest = m % 60;
	return rest ? `${h}h ${rest}m to go` : `${h}h to go`;
}

/** Serials print grouped in threes on the hardware label: QSS-2B7-8BD-9KE. */
export function groupSerial(serial: string): string {
	return serial.replace(/(.{3})(?=.)/g, "$1-");
}

/**
 * The panel reports its own scale on the home screen. Everything that shows or
 * bounds a temperature has to ask, since the two scales share no numbers.
 */
export function isCelsius(raw: unknown): boolean {
	const scale = (raw as { temp_scale?: unknown } | undefined)?.temp_scale;
	return String(scale ?? "F").toUpperCase() === "C";
}

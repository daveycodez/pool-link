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

/** Serials print grouped in threes on the hardware label: QSS-2B7-8BD-9KE. */
export function groupSerial(serial: string): string {
	return serial.replace(/(.{3})(?=.)/g, "$1-");
}

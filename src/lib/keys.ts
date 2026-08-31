/**
 * Query keys, in their own module because the session store reads them and the
 * queries do too — sharing them through either one would import in a circle.
 *
 * Everything an account owns is keyed under its user id. Two accounts on one
 * device otherwise read each other's cache: the entries are named the same, so
 * a restore after signing in as someone else hands over the previous account's
 * systems and macros. The session itself cannot be namespaced — it is what
 * says who the user is — so it stays at the root and is cleared on sign-out.
 */
export const keys = {
	session: () => ["session"] as const,
	systems: (uid: string) => [uid, "systems"] as const,
	/** Everything read from one panel, so a mutation can invalidate the lot. */
	panel: (uid: string, serial: string) => [uid, "panel", serial] as const,
	home: (uid: string, serial: string) =>
		[uid, "panel", serial, "home"] as const,
	devices: (uid: string, serial: string) =>
		[uid, "panel", serial, "devices"] as const,
	onetouch: (uid: string, serial: string) =>
		[uid, "panel", serial, "onetouch"] as const,
	/**
	 * The chlorinator's configuration — a fourth panel screen, so it sits under
	 * the same prefix and one panel invalidation still refreshes everything.
	 */
	swc: (uid: string, serial: string) => [uid, "panel", serial, "swc"] as const,
	/**
	 * The chemistry probe's report on itself — presence and health, not the
	 * reading, which arrives with the home screen. A fifth panel screen, under
	 * the same prefix for the same reason as the fourth.
	 */
	phorp: (uid: string, serial: string) =>
		[uid, "panel", serial, "phorp"] as const,
	/**
	 * The colour-light zones as their own read. A sixth panel screen, under the
	 * same prefix so a zone mutation's one `panel` invalidation still reaches it
	 * — which is what lets this ride a slow cadence without a zone change
	 * sitting unseen until the next tick.
	 */
	icl: (uid: string, serial: string) => [uid, "panel", serial, "icl"] as const,
	/**
	 * When the chemistry probe was last calibrated, and whether it is being
	 * calibrated now. Separate from `phorp` because the two answer different
	 * questions on wildly different clocks — presence is wiring and is polled by
	 * the minute, while a calibration date moves when somebody stands at the pad
	 * with a bottle in their hand — and a shared entry would drag one to the
	 * other's cadence. Under the panel prefix like the rest, so a calibration
	 * this app starts refreshes it without naming it.
	 */
	phorpCalib: (uid: string, serial: string) =>
		[uid, "panel", serial, "phorpCalib"] as const,
	/**
	 * The panel's own timed programs. A seventh panel screen, under the same
	 * prefix so an edit made here refreshes with one invalidation like the rest.
	 */
	schedules: (uid: string, serial: string) =>
		[uid, "panel", serial, "schedules"] as const,
	/**
	 * The id↔name table a schedule has to be read through, since the schedule
	 * list names "device 12" and never "Waterfall".
	 *
	 * Outside the `panel` prefix, where `vsp` already sits and for the same
	 * reason: this is the pad's wiring, not its state. Every panel mutation
	 * invalidates that prefix and waits on what it refetches, so anything filed
	 * under it is something a person waits for after flipping a switch. Wiring
	 * changes when equipment is installed; making a light toggle re-read it
	 * would be paying a request to learn nothing.
	 */
	scheduleDevices: (uid: string, serial: string) =>
		[uid, "scheduleDevices", serial] as const,
	/**
	 * The pump speeds a schedule can name — the same argument as above and a
	 * dearer one, since this costs a request per pump and the panel answers
	 * commands one at a time. It also cannot be asked for until the device table
	 * has said which ids are pumps, so it is the slowest thing here to refetch
	 * and the least likely ever to have changed.
	 */
	scheduleSpeeds: (uid: string, serial: string) =>
		[uid, "scheduleSpeeds", serial] as const,
	status: (uid: string, serial: string) => [uid, "status", serial] as const,
	/** Prefix that matches every system's status query. */
	statuses: (uid: string) => [uid, "status"] as const,
	vsp: (uid: string, serial: string) => [uid, "vsp", serial] as const,
	/**
	 * All twenty pump slots, empty ones included — the setup pages' spine, and
	 * outside `panel` on the same argument as `vsp`: which slot holds which
	 * pump is wiring, and it changes when somebody installs a pump.
	 */
	vspSlots: (uid: string, serial: string) => [uid, "vspSlots", serial] as const,
	/**
	 * Per-slot commissioning data: the unit its speeds are counted in, the
	 * model behind it, and the speeds the panel runs unasked. The most static
	 * thing the app reads — none of it moves unless a person changes it here —
	 * which is why it is never polled, only invalidated by its own writes.
	 */
	vspDefs: (uid: string, serial: string) => [uid, "vspDefs", serial] as const,
	/**
	 * One slot's eight speeds, unfiltered, for the page that edits them. Keyed
	 * per slot because only the open pump is ever worth asking about.
	 */
	vspSlotSpeeds: (uid: string, serial: string, slotId: number) =>
		[uid, "vspSlotSpeeds", serial, slotId] as const,
};

/**
 * Where a key's kind sits, now that the user id is in front. `panel` groups
 * three screens, so its kind is one level deeper than the rest.
 */
export function keyKind(queryKey: readonly unknown[]): string {
	if (queryKey[0] === "session") return "session";
	return queryKey[1] === "panel"
		? `panel:${String(queryKey[3])}`
		: String(queryKey[1]);
}

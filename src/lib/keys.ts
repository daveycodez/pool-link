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
	status: (uid: string, serial: string) => [uid, "status", serial] as const,
	/** Prefix that matches every system's status query. */
	statuses: (uid: string) => [uid, "status"] as const,
	vsp: (uid: string, serial: string) => [uid, "vsp", serial] as const,
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

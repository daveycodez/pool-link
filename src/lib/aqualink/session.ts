import { keys } from "#/lib/keys";
import { flushPersisted, readPersisted } from "#/lib/persist";
import { queryClient } from "#/lib/query-client";

/**
 * The signed-in session. The account password is NEVER stored — we keep the
 * refresh token and mint fresh idTokens from it.
 */
export interface Session {
	email: string;
	/** per-session id used as `sessionID` on every p-api command. */
	clientId: string;
	/** 17-char prm user id (also `userId` for prm endpoints). */
	userId: string;
	idToken: string;
	refreshToken: string;
	appClientId: string;
	country: string;
}

/**
 * Held in the query cache rather than a store of its own. It is persisted the
 * same way everything else is, `useSession` reads it without a wrapper around
 * a second database, and signing out clears it with the rest.
 *
 * Reads are synchronous against the cache. Nothing calls these before the
 * restore has finished, because every request originates from a query and the
 * provider holds those idle until it has.
 */
export async function loadSession(): Promise<Session | null> {
	return queryClient.getQueryData<Session | null>(keys.session()) ?? null;
}

/**
 * The session as it sits in shared storage, which is not necessarily the one
 * this tab is holding.
 *
 * `loadSession` reads this tab's own cache and can only ever return what this
 * tab last wrote or restored at boot. This reads the copy every tab on the
 * origin writes through, which is the only place one tab can learn that another
 * has rotated the refresh token out from under it. Null when there is nothing
 * stored, or when what is stored carries no refresh token — there is nothing to
 * try with a session that cannot be renewed.
 */
export async function storedSession(): Promise<Session | null> {
	const stored = await readPersisted<Session | null>(keys.session());
	return stored?.refreshToken ? stored : null;
}

export async function saveSession(session: Session): Promise<void> {
	queryClient.setQueryData(keys.session(), session);
	// Written through rather than left to the throttle: the pool rotates the
	// refresh token, so a save followed by a close inside the throttle window
	// would lose the new one while the old is already dead.
	await flushPersisted();
}

export async function clearSession(): Promise<void> {
	queryClient.setQueryData(keys.session(), null);
	await flushPersisted();
}

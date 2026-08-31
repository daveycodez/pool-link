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
	setRefused(false);
	queryClient.setQueryData(keys.session(), session);
	// Written through rather than left to the persister's own subscription: the
	// pool rotates the refresh token, so the moment this returns the previous
	// one is dead and the new one has to already be on disk. `flushPersisted`
	// is what makes that true — see the note there about why awaiting the
	// persister does not.
	await flushPersisted();
}

/**
 * End the session everywhere, storage included.
 *
 * The only caller is a deliberate sign-out, and that is the whole point. This
 * write reaches every tab on the origin and every future boot, so nothing that
 * merely suspects the session is over may make it — see `refuseSession`.
 */
export async function clearSession(): Promise<void> {
	setRefused(false);
	queryClient.setQueryData(keys.session(), null);
	await flushPersisted();
}

/**
 * A refusal this tab is carrying, held in memory and nowhere else.
 *
 * Nowhere else is the whole point, and `refuseSession` explains why.
 */
let refused = false;
const watchers = new Set<() => void>();

function setRefused(next: boolean): void {
	if (refused === next) return;
	refused = next;
	for (const watcher of watchers) watcher();
}

/**
 * Stop trusting this tab's session, without touching the copy in storage.
 *
 * Being refused is a different thing from having no session, and the whole of
 * this exists to keep the two apart. The session lives in the query cache, and
 * the cache is dehydrated to IndexedDB whenever it changes — so writing null
 * into the session query is not a local gesture. It is a destructive write to
 * the single durable copy the whole origin shares, it outlives the tab that
 * made it, and nothing can undo it, because the refresh token it overwrites was
 * the only proof the account was ever alive. That is what made one refused
 * refresh permanent.
 *
 * And a refusal is poor evidence that the account is really over. A rotation
 * lost because a reload landed between the pool's answer and the write that
 * stores it looks exactly like one. So does another tab's newer token reaching
 * storage a moment after this tab read it. So does anything between here and
 * Cognito answering 400 for a reason of its own. Only one of those four is a
 * session that has genuinely ended, and from this side of the wire they are
 * indistinguishable.
 *
 * So the refusal is held here, for the life of the tab. `useSession` reports it
 * as an absent session, which is the question every screen was already asking,
 * so the header empties, the account-scoped queries switch off and the route
 * guard sends the page to /login exactly as before. What no longer happens is
 * the write. Storage keeps the session, so a reload gets to put the stored
 * token to the pool instead of being handed a null by a tab that had already
 * given up — which makes a sign-out that should not have happened recoverable
 * by the one gesture anybody would try anyway.
 */
export function refuseSession(): void {
	setRefused(true);
}

export function sessionRefused(): boolean {
	return refused;
}

/** Subscribe form, for the `useSyncExternalStore` in `useSession`. */
export function watchRefusal(onChange: () => void): () => void {
	watchers.add(onChange);
	return () => {
		watchers.delete(onChange);
	};
}

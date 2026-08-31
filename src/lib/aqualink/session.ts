import { toast } from "@heroui/react";
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
	forgetRefusal();
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
	forgetRefusal();
	queryClient.setQueryData(keys.session(), null);
	await flushPersisted();
}

/**
 * How long a refused tab waits before putting the stored session back to the
 * pool, and how many times it will.
 *
 * Short, because the whole window is spent on the login screen: the refusal
 * empties `useSession`, the guard redirects, and until this fires there is
 * nothing on screen but a sign-in form for an account that may well still be
 * alive. Three tries at five seconds is fifteen seconds of trying before the
 * app concedes, and each one costs a single refresh — `refreshOnce` collapses
 * the ten queries that wake up together into one request.
 *
 * Retrying at all is the part `16aa529` left out. It moved the refusal out of
 * storage so that a reload could put the stored token to the pool again, which
 * is a real recovery and one that nothing ever performs: the app does not
 * reload itself, and a person looking at a login form signs in rather than
 * pressing refresh. So the recovery has to be the app's own.
 */
const REFUSAL_RETRY_MS = 5_000;
const REFUSAL_RETRIES = 3;

/**
 * A refusal this tab is carrying, held in memory and nowhere else.
 *
 * Nowhere else is the whole point, and `refuseSession` explains why.
 */
let refused = false;
const watchers = new Set<() => void>();

/**
 * The refresh token the refusal was about, the tries left to put it back, and
 * whether this episode has been announced.
 *
 * The token is kept so `retryRefusal` can tell the two recoveries apart. A
 * stored token that differs from this one is another tab's, freshly rotated,
 * and deserves a full budget of its own; the same token going back up the wire
 * is a second opinion on a rejection that may never have been about the token.
 */
let refusedToken: string | null = null;
let retries = 0;
let announced = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setRefused(next: boolean): void {
	if (refused === next) return;
	refused = next;
	for (const watcher of watchers) watcher();
}

/** Drop the whole episode: no latch, no timer, and a fresh budget. */
function forgetRefusal(): void {
	if (retryTimer !== null) clearTimeout(retryTimer);
	retryTimer = null;
	refusedToken = null;
	retries = 0;
	announced = false;
	setRefused(false);
}

/**
 * Lift the refusal and hand this tab whatever storage holds, so the queries
 * that switched off wake up and try it.
 *
 * Seeding the cache is what makes the retry worth anything. The client caches
 * its own copy and `restore` reads the query cache, so lifting the flag alone
 * would only put the same refused token back up the wire; the copy in storage
 * is the one that may have moved on.
 */
async function retryRefusal(): Promise<void> {
	retryTimer = null;
	if (!refused) return;
	const stored = await storedSession();
	// Nothing to put back, or a sign-in landed while that read was out. Either
	// way there is no retry to make.
	if (!stored || !refused) return;
	// Another tab's token is a different credential, not another go at this
	// one, so it starts again from a full budget.
	retries = stored.refreshToken === refusedToken ? retries + 1 : 0;
	queryClient.setQueryData(keys.session(), stored);
	refusedToken = null;
	setRefused(false);
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
 * So the refusal is held here rather than written, and it is held briefly.
 * `useSession` reports it as an absent session, which is the question every
 * screen was already asking, so the header empties, the account-scoped queries
 * switch off and the route guard goes to /login. But storage keeps what it
 * holds, and this tab puts it back to the pool a few seconds later, up to
 * REFUSAL_RETRIES times — so of those four cases the three that were never
 * about a dead account recover on their own, without a reload, and the person
 * who was looking at a login screen is returned to their pool.
 *
 * Only a token the pool refuses every time ends the episode, and that one is
 * announced. Silence was half the problem: a 401 is a signal this app expects,
 * the toast was suppressed for it, and the screen simply became a login form
 * for no stated reason.
 */
export function refuseSession(token: string | null = null): void {
	refusedToken = token;
	setRefused(true);
	if (!announced) {
		announced = true;
		toast.danger("Signed out — iAqualink refused the saved session");
	}
	if (retries >= REFUSAL_RETRIES || retryTimer !== null) return;
	retryTimer = setTimeout(() => void retryRefusal(), REFUSAL_RETRY_MS);
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

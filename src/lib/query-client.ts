import { toast } from "@heroui/react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { AqualinkError, errorMessage } from "#/lib/aqualink/types";

/** Repeats of the same message are one event, not several. */
const TOAST_DEDUPE_MS = 10_000;
let lastToast = { at: 0, message: "" };

function toastError(error: unknown) {
	const message = errorMessage(error);
	const now = Date.now();
	if (message === lastToast.message && now - lastToast.at < TOAST_DEDUPE_MS)
		return;
	lastToast = { at: now, message };
	toast.danger(message);
}

/**
 * A 401 is the session's business, not a screen's, so it is swallowed here
 * rather than toasted: by the time this runs the client has either refreshed
 * and retried, or refused the session — and a refusal announces itself, from
 * `refuseSession`, where it also knows whether it is about to retry.
 *
 * It deliberately no longer invalidates the session query, and that line was
 * signing people out of accounts that were perfectly alive. Not every 401 here
 * comes from a server: `currentSession` raises one locally, with no request
 * made, whenever it is asked for a session before one has loaded. A full page
 * reload is exactly that moment — the module-scope client is rebuilt holding no
 * session while the persister is still reading IndexedDB — and in development
 * every save of a module that declines HMR forces one.
 *
 * From there it closed a loop. The session query's fetcher reads the session
 * out of the query cache, because signing in is what puts it there; so
 * invalidating that query on a 401 asked the cache what the cache held, and in
 * that window the honest answer was nothing. Nothing became the stored session,
 * the persister wrote it to IndexedDB on the next tick, and the tab redirected
 * to the login screen holding a valid token it had simply not finished reading.
 *
 * Nothing is lost by dropping it. A session that genuinely dies goes through
 * `refuseSession`, which every reader already subscribes to.
 *
 * With one exception, which the caller has to supply because this cannot see
 * it: signing in answers 401 for a password that was simply wrong, and there is
 * no session behind that to have expired — so its message must not be
 * swallowed as though there were.
 */
function signedOut(error: unknown) {
	return error instanceof AqualinkError && error.status === 401;
}

/**
 * One client for the whole app, at module scope rather than in a component:
 * the session lives in this cache, and the API client reads it from outside
 * React on every request.
 */
export const queryClient: QueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Retry count is the library default. Only the backoff cap is ours:
			// theirs tops out at 30s, several times the poll interval, and a query
			// will not start its next scheduled poll while a retry is pending — so
			// a blip could hold the screen on much older data than polling again
			// would have given. Capped near one interval, the poll is the retry.
			retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
			refetchOnWindowFocus: false,
			staleTime: 5_000,
		},
	},
	queryCache: new QueryCache({
		onError: (error, query) => {
			if (signedOut(error)) return;
			// A poll that fails behind data we already hold changes nothing on
			// screen and the next one will likely succeed. The header's updated-at
			// is the honest signal for that, not a toast.
			if (query.state.data !== undefined) return;
			toastError(error);
		},
	}),
	mutationCache: new MutationCache({
		onError: (error, _variables, _context, mutation) => {
			// `signIn` opts a mutation out of the sign-out reading of a 401 — see
			// signedOut. Only the sign-in mutation sets it, because it is the only
			// one whose 401 is about credentials rather than a session.
			if (!mutation.meta?.signIn && signedOut(error)) return;
			toastError(error);
		},
	}),
});

// Not hot-swappable: an HMR re-run mints a fresh, empty client while the
// mounted tree keeps the old one — the request layer then reads a cache with
// no session in it and requests fail "Not authenticated" until a reload.
// Declining makes Vite do that reload up front, atomically.
if (import.meta.hot)
	import.meta.hot.accept(() => import.meta.hot?.invalidate());

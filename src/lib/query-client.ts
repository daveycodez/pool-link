import { toast } from "@heroui/react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { AqualinkError, errorMessage } from "#/lib/aqualink/types";
import { keys } from "#/lib/keys";

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
 * A 401 means the session is gone — the client has already cleared it by the
 * time this runs. Re-reading it turns useRequireSession's guard from something
 * that only fires on a cold start into one that catches a session dying
 * mid-use, and the redirect to /login says it better than a toast would.
 */
function signedOut(error: unknown) {
	if (!(error instanceof AqualinkError) || error.status !== 401) return false;
	queryClient.invalidateQueries({ queryKey: keys.session() });
	return true;
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
		onError: (error) => {
			if (signedOut(error)) return;
			toastError(error);
		},
	}),
});

// Not hot-swappable: an HMR re-run mints a fresh, empty client while the
// mounted tree keeps the old one — the request layer then reads a cache with
// no session in it and requests fail "Not authenticated" until a reload.
// Declining makes Vite do that reload up front, atomically.
if (import.meta.hot) import.meta.hot.decline();

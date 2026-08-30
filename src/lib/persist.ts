import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";
import { PERSIST_MAX_AGE_MS } from "#/lib/queries";

const KEY = "pool-link:query-cache";

const canUseIDB = () => typeof indexedDB !== "undefined";

/**
 * Bumped when what is persisted changes shape. A restored cache that no longer
 * matches what the code expects is worse than a cold start, so this throws the
 * old one away rather than trying to read it.
 */
const BUSTER = "1";

/**
 * What survives a reload. Only what is slow to fetch and stable enough to be
 * true days later:
 *
 * - `systems` gates the header's title and the single-system redirect, so
 *   persisting it is the difference between a spinner and a screen.
 * - `vsp` is the expensive one — two requests plus one per pump, two round
 *   trips deep — and it holds pump names, speed tables and aux bindings, which
 *   change only when someone rewires the pad.
 *
 * Everything else is deliberately excluded. A snapshot is water temperature and
 * what is running right now; showing yesterday's would be a lie the app cannot
 * detect. `status` is liveness itself. And the session holds tokens, which have
 * their own store and do not need a second copy here.
 */
const PERSISTED = new Set(["systems", "vsp"]);

/**
 * The panel's screens are separate queries under one prefix, and only one of
 * them is safe to keep: macros are names, where the home and devices screens
 * are water temperature and which relays are closed. A restored reading would
 * be a lie the app cannot detect, so those two are never written.
 */
const PERSISTED_PANEL = new Set(["onetouch"]);

const persister = createAsyncStoragePersister({
	key: KEY,
	// The prerender has no IndexedDB, and reaching for it there hangs the build
	// rather than failing — so off the client this reads as an empty store and
	// writes nowhere, which is what "do not persist on the server" means in
	// practice. session.ts guards the same way for the same reason.
	storage: {
		getItem: async (k) =>
			canUseIDB() ? ((await get<string>(k)) ?? null) : null,
		removeItem: async (k) => {
			if (canUseIDB()) await del(k);
		},
		setItem: async (k, v) => {
			if (canUseIDB()) await set(k, v);
		},
	},
	throttleTime: 2_000,
});

/**
 * Passed to PersistQueryClientProvider, which is what the docs call for in
 * React: it holds queries idle until the restore lands, so a cold start does
 * not fire a request for data that is about to arrive from storage anyway.
 * The imperative persistQueryClient races that, and never unsubscribes.
 */
export const persistOptions = {
	buster: BUSTER,
	dehydrateOptions: {
		shouldDehydrateQuery: (query: Query) =>
			// Successful only, as the library's own default insists — a restored
			// error would present as data the app never fetched.
			defaultShouldDehydrateQuery(query) &&
			(query.queryKey[0] === "panel"
				? PERSISTED_PANEL.has(String(query.queryKey[2]))
				: PERSISTED.has(String(query.queryKey[0]))),
	},
	maxAge: PERSIST_MAX_AGE_MS,
	persister,
};

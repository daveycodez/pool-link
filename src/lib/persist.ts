import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
	defaultShouldDehydrateQuery,
	dehydrate,
	hashKey,
	type Query,
} from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";
import { keyKind } from "#/lib/keys";
import { queryClient } from "#/lib/query-client";

/**
 * How long a persisted entry may be reused. Long, because what is kept barely
 * changes — pump wiring moves when someone rewires the pad, and not otherwise
 * — and everything restored is refetched on mount regardless, so age costs at
 * most a stale first paint.
 *
 * The persister applies this to the whole stored blob rather than per query,
 * so the systems list rides the same window. That is harmless for the same
 * reason: it is replaced by a fetch as soon as anything mounts.
 */
export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The gcTime for persisted queries: never collect. It cannot be a large finite
 * number, twice over. gcTime is a real setTimeout armed when a query's last
 * watcher unmounts — during the prerender that timer is what kept the build
 * process from exiting, and in a browser a delay past ~24.8 days overflows the
 * 32-bit signed int setTimeout takes, fires immediately, and collects the
 * query the moment its page unmounts (which is how the pump speeds vanished on
 * every visit to settings). Infinity is the one value react-query treats as
 * "no timer at all", and holding a handful of queries in memory for the life
 * of the tab costs nothing. PERSIST_MAX_AGE_MS still bounds how old a restore
 * from storage may be.
 */
export const PERSIST_GC_TIME_MS = Infinity;

const KEY = "pool-link:query-cache";

const canUseIDB = () => typeof indexedDB !== "undefined";

/**
 * Bumped when what is persisted changes shape. A restored cache that no longer
 * matches what the code expects is worse than a cold start, so this throws the
 * old one away rather than trying to read it.
 *
 * "2": the keys grew the account prefix and the session moved into the cache,
 * and "1"-era blobs restored as if nothing had changed — a device that had
 * visited before could restore itself into an endless spinner.
 */
const BUSTER = "2";

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
const PERSISTED = new Set([
	// Signing in is the slowest thing the app does, and the session is the only
	// reason it has to happen again.
	"session",
	"systems",
	"vsp",
	// Of the panel's three screens only macros are safe to keep: they are
	// names, where home and devices are water temperature and which relays are
	// closed. A restored reading would be a lie the app cannot detect.
	"panel:onetouch",
	// The panel's timed programs and the equipment they can name. Configuration
	// on both counts, which is the same argument `vsp` makes: these change when
	// somebody edits a program or rewires the pad, not while anyone is watching.
	//
	// A schedule is the one thing here that is neither a reading nor purely a
	// name, so it was worth arguing over. What settles it is that a schedule
	// window is not a claim about this moment. "The spa runs 4PM to 4AM" is as
	// true from storage as it is from the wire, where "the spa is on" is not —
	// and the window is exactly what an owner needs on screen to understand
	// equipment that turns itself back on. Restoring it also puts the programs
	// in hand for the screens that mark held equipment, which cannot wait on a
	// request to know whether a switch is about to lose.
	//
	// It is refetched on mount regardless, so the worst a restore can do is show
	// a correct answer from a minute ago until the poll replaces it.
	"panel:schedules",
	"scheduleDevices",
	// The speeds those devices offer, on the same argument and at a higher
	// price: one request per pump, for names that change when a pump is
	// reconfigured and not otherwise.
	"scheduleSpeeds",
	// The pump slot table and the per-slot definitions behind it. Commissioning
	// data in the strictest sense: what pump is in which slot, what model it is,
	// and what unit its speeds are counted in. None of it can change without a
	// person changing it, so neither is ever polled — they are fetched once and
	// then live here until a write on this pad's own setup pages invalidates
	// them. `vspDefs` also carries the unit the equipment page needs to label a
	// flow pump's speeds correctly, so persisting it is what keeps that label
	// right on the first paint after a reload rather than a request later.
	"vspSlots",
	"vspDefs",
	// The speed tables behind them, one entry per pump that has been opened.
	// These do move — a speed can be renamed at the panel — so unlike the two
	// above they are refetched on mount and merely painted from storage while
	// that lands, which is what keeps a pump's page from starting on a spinner
	// every time it is opened.
	"vspSlotSpeeds",
]);

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
	// No throttle, so a change the subscription notices is written at once
	// rather than up to a second later. It is not what makes a write durable,
	// though — see `flushPersisted`, which is where the one caller that needs
	// that guarantee goes to get it.
	throttleTime: 0,
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
			PERSISTED.has(keyKind(query.queryKey)),
	},
	maxAge: PERSIST_MAX_AGE_MS,
	persister,
};

/**
 * One query's data as it sits in storage right now, rather than as this tab
 * remembers it.
 *
 * The in-memory cache is per-tab. The persister reads IndexedDB exactly once, at
 * boot, and nothing subscribes to it afterwards — so `queryClient.getQueryData`
 * cannot see a write another tab made a minute ago, however durable that write
 * was. This is the only way back to the shared copy, and it exists for one
 * caller: the refresh path, where a second tab on the same account may already
 * hold the rotated token this one is about to be signed out over.
 *
 * Both of the boot restore's own guards are applied here, so the two agree about
 * what is readable at all. A blob written under a previous BUSTER is not this
 * shape and start-up would throw it away rather than read it; one older than
 * PERSIST_MAX_AGE_MS is not offered to the app either. Reading past either rule
 * here would mean acting on a session start-up would have refused.
 */
export async function readPersisted<T>(
	queryKey: readonly unknown[],
): Promise<T | undefined> {
	const stored = await persister.restoreClient();
	if (!stored || stored.buster !== BUSTER) return undefined;
	if (Date.now() - stored.timestamp > PERSIST_MAX_AGE_MS) return undefined;
	const hash = hashKey(queryKey);
	return stored.clientState.queries.find((q) => q.queryHash === hash)?.state
		.data as T | undefined;
}

/**
 * Write the cache out now, and do not return until it is really written.
 *
 * Not `persister.persistClient`, which is the obvious call and cannot promise
 * that. Every write the persister makes goes through an async throttle that
 * keeps one write running and one queued; a third caller arriving while those
 * two are outstanding has its arguments recorded and its promise resolved on
 * the spot, having written nothing at all. A third caller is the ordinary case
 * on the pool screen, because the persister also subscribes to the cache and
 * every poll that lands is another write. So `await`ing it meant "somebody will
 * write this shortly", where the caller that matters — a rotated refresh token,
 * whose predecessor the pool retires the instant it answers — needs "this is on
 * disk now".
 *
 * The bytes and the key are the persister's own, so the two agree about what is
 * stored and `restoreClient` reads this back; it simply goes straight to
 * IndexedDB and waits for the transaction to commit.
 */
export async function flushPersisted() {
	if (!canUseIDB()) return;
	await set(
		KEY,
		JSON.stringify({
			buster: BUSTER,
			clientState: dehydrate(queryClient, persistOptions.dehydrateOptions),
			timestamp: Date.now(),
		}),
	);
}

// Same as query-client.ts: the persister and its subscription are singletons.
if (import.meta.hot)
	import.meta.hot.accept(() => import.meta.hot?.invalidate());

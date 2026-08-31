import { useCallback, useEffect, useState } from "react";

/**
 * Whether this device could still be given a home-screen icon, and the one
 * gesture that does it.
 *
 * Two browsers, two answers. Chrome and the browsers built on it fire
 * `beforeinstallprompt` when they judge a site installable, and hand over an
 * event that can be fired later from a click of our own — so there the app can
 * offer a real button. Safari never implemented any of it: on iOS installing is
 * Share → Add to Home Screen, a menu in the browser's own chrome that nothing
 * on the page can open, so all the app can do is say where it is.
 *
 * Everything here is read from the window, so all of it is unknown until the
 * app has mounted — see the null state below.
 */

/** The event Chrome hands over. Not in lib.dom, so it is spelled out here. */
type InstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Snapshot = {
	/** Chrome's deferred event, held for a gesture of ours. */
	event: InstallPromptEvent | null;
	/** Running as an installed app rather than in a browser tab. */
	installed: boolean;
};

/**
 * Module state rather than component state, because the event arrives on its
 * own schedule — often before anything that cares has mounted, and exactly
 * once. Whoever asks later still gets it.
 */
let snapshot: Snapshot = { event: null, installed: false };
const subscribers = new Set<() => void>();

function update(next: Partial<Snapshot>) {
	snapshot = { ...snapshot, ...next };
	for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
	subscribers.add(notify);
	return () => {
		subscribers.delete(notify);
	};
}

/**
 * Already installed, or being run from the installed icon. `display-mode` is
 * the standard answer and `navigator.standalone` the only one iOS gives, so
 * both are asked.
 */
function standalone(): boolean {
	return (
		matchMedia("(display-mode: standalone)").matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * iOS, where the install lives in a menu. iPadOS reports itself as a Mac and
 * has for years; the touch points are what give it away.
 */
function ios(): boolean {
	const ua = navigator.userAgent;
	return (
		/iphone|ipad|ipod/i.test(ua) ||
		(/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
	);
}

/**
 * Whether the browser will ever offer an install of its own.
 *
 * Chromium defines the handler property whether or not the event ever fires;
 * WebKit defines nothing at all. Asked as a feature rather than read off the
 * user agent, because the agent string is a guess and this is not — a Mac that
 * answers this yes is a Chrome that can prompt, whatever it calls itself, and
 * pointing it at a Share menu it does not have is the one wrong answer here.
 */
const CAN_EVENT =
	typeof window !== "undefined" && "onbeforeinstallprompt" in window;

/** Constant for the life of the tab, so it is settled once rather than asked. */
const IOS = typeof navigator === "undefined" ? false : ios();

if (typeof window !== "undefined") {
	// Whatever the shell's inline listener has already caught. See __root: the
	// event can arrive before this module exists, and it is never offered twice.
	const parked = (window as { __poolLinkInstall?: InstallPromptEvent })
		.__poolLinkInstall;
	snapshot = { event: parked ?? null, installed: standalone() };

	addEventListener("beforeinstallprompt", (event) => {
		// Catching it is the whole point: left alone, the browser shows its own
		// bar wherever it likes and the event is gone. Kept, it becomes a button
		// this app can put somewhere the moment is right for.
		event.preventDefault();
		update({ event: event as InstallPromptEvent });
	});

	// Fires however they installed it — our button, or the browser's own menu.
	addEventListener("appinstalled", () => {
		update({ event: null, installed: true });
	});
}

export type Install = {
	/** A gesture of ours can raise the browser's install dialog right now. */
	canPrompt: boolean;
	/** Installable, but only by hand — iOS, where all we can offer is the way. */
	manual: boolean;
	/** Installed already, so there is nothing to offer. */
	installed: boolean;
	/** Raise the dialog. A no-op unless `canPrompt`. */
	install: () => void;
};

export function useInstall(): Install {
	// Null until mounted, which is what keeps this off the prerendered shell:
	// none of it is knowable without a window, and a first client render that
	// disagreed with the server's would be a hydration mismatch over a banner.
	const [state, setState] = useState<Snapshot | null>(null);

	useEffect(() => {
		const sync = () => setState(snapshot);
		sync();
		return subscribe(sync);
	}, []);

	const event = state?.event ?? null;
	const install = useCallback(() => {
		if (!event) return;
		// Dropped before it is fired, not after: the browser will not hand the
		// same event over twice, so whichever way the dialog goes there is
		// nothing left to prompt with and the offer should stop being made.
		update({ event: null });
		event.prompt();
	}, [event]);

	const installed = state?.installed ?? false;

	return {
		canPrompt: Boolean(event) && !installed,
		installed,
		// `state !== null` is the mounted check: on the server, and on the render
		// that matches it, this app knows of no iPhone.
		manual: state !== null && IOS && !CAN_EVENT && !installed,
		install,
	};
}

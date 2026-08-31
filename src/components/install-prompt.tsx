import { Alert, Button, CloseButton } from "@heroui/react";
import { Share } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstall } from "#/lib/use-install";
import { useOnline } from "#/lib/use-online";

/**
 * The one time this app asks for something: a home-screen icon.
 *
 * Rendered by the layout on every signed-in page, which in practice means the
 * panel — a single-system account is redirected straight through the list and
 * never sees it. Deliberately not on /login: nobody installs a pool app before
 * they have seen their pool, and the sign-in card is the one screen with no
 * chrome over it.
 *
 * It comes down over the header rather than pushing the page down, so nothing
 * on screen moves under a finger already reaching for it.
 */

/** Not on the first visit. An icon is worth offering to somebody who came back. */
const VISITS_BEFORE_ASKING = 2;
/** Long enough for the first snapshot to have landed and been read. */
const SETTLE_MS = 8_000;
/** What "not now" buys. An answer, not a silence — a season later is fair. */
const DISMISSED_FOR_MS = 30 * 24 * 60 * 60 * 1_000;

const VISITS_KEY = "pool-link:install-visits";
const DISMISSED_KEY = "pool-link:install-dismissed";

function read(key: string): number {
	try {
		return Number(localStorage.getItem(key)) || 0;
	} catch {
		return 0;
	}
}

function write(key: string, value: number) {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Storage is unavailable in a private window. Nothing here is worth
		// making a fuss about — the banner simply never reaches its second visit.
	}
}

/** One count per load, and this mounts twice under StrictMode in development. */
let counted = false;

function countVisit(): number {
	if (!counted) {
		counted = true;
		write(VISITS_KEY, read(VISITS_KEY) + 1);
	}
	return read(VISITS_KEY);
}

export function InstallPrompt() {
	const { canPrompt, manual, install } = useInstall();
	const online = useOnline();
	const [armed, setArmed] = useState(false);

	useEffect(() => {
		if (countVisit() < VISITS_BEFORE_ASKING) return;
		if (Date.now() - read(DISMISSED_KEY) < DISMISSED_FOR_MS) return;
		const id = setTimeout(() => setArmed(true), SETTLE_MS);
		return () => clearTimeout(id);
	}, []);

	function dismiss() {
		setArmed(false);
		write(DISMISSED_KEY, Date.now());
	}

	// Armed says the moment is right; the browser says whether there is anything
	// to offer, and it may only say so after the timer has already run. Offline
	// is the one moment this stays out of the way: the foot of the screen
	// already carries a warning, and the water on screen is old.
	if (!armed || !online || !(canPrompt || manual)) return null;

	// The prompt has to be raised inside the press to count as a gesture, so the
	// dismissal is recorded after it. Either outcome is an answer: a declined
	// dialog is not a question worth putting again next week.
	function accept() {
		install();
		dismiss();
	}

	return (
		// Landscape puts the insets on the sides, same as the layout's own floor.
		<div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]">
			<Alert
				className="pointer-events-auto w-full max-w-md animate-in shadow-surface duration-300 fade-in slide-in-from-top-4"
				status="accent"
			>
				{/* The manifest's own 192, not the app's stroke mark: this is asking
				    for a home-screen icon, so it shows the very tile that would land
				    there — plate, accent and all. The plate's corners are cut here
				    rather than in the file, which is flattened square so a launcher
				    can round it its own way. */}
				{/* Both halves need holding: the indicator is a flex item of the
				    alert's row and shrinks with it, and Safari squeezes an image
				    inside a squeezed box rather than letting it overflow. So the
				    box refuses to shrink, the tile carries a floor of its own, and
				    object-contain means even a wrong box cannot stretch it. */}
				<Alert.Indicator className="shrink-0">
					<img
						alt=""
						className="size-8 min-w-8 shrink-0 rounded-lg object-contain"
						src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
					/>
				</Alert.Indicator>
				<Alert.Content>
					{/* The base styles separate title from description by one weight
					    step at the same size, which at 14px is barely a difference —
					    and the description below is the longer line of the two. */}
					<Alert.Title className="font-semibold">
						Install Pool Link App
					</Alert.Title>
					<Alert.Description>
						Add it to your home screen
						{/* No button to press on iOS, so the one line it gets has to
						    carry the way there as well as the reason — and the way
						    there is a glyph in Safari's toolbar, not a word, so the
						    line shows the glyph. */}
						{manual ? (
							<>
								{" — tap "}
								<Share
									aria-label="Share"
									className="inline size-4 align-text-bottom"
									role="img"
								/>
								{", then Add to Home Screen"}
							</>
						) : null}
					</Alert.Description>
					{/* The action sits beside the text where there is room for it and
					    under the text where there is not — one button per width, so
					    neither is a cramped column nor a stranded row. */}
					{canPrompt ? (
						<Button className="mt-2 sm:hidden" onPress={accept} size="sm">
							Install
						</Button>
					) : null}
				</Alert.Content>
				{canPrompt ? (
					<Button
						className="hidden shrink-0 sm:block"
						onPress={accept}
						size="sm"
					>
						Install
					</Button>
				) : null}
				<CloseButton aria-label="Dismiss" onPress={dismiss} />
			</Alert>
		</div>
	);
}

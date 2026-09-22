import { Alert, Button, CloseButton } from "@heroui/react";
import { Share } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstall } from "#/lib/use-install";
import { useOnline } from "#/lib/use-online";

/**
 * The one time this app asks for something: a home-screen icon.
 *
 * Asked twice, in the two places somebody arrives at. Once over the sign-in
 * card, where an installed icon saves the next arrival, and once past it, on
 * whichever page the account lands on — the systems list, or the panel itself
 * for the single-system account the list redirects straight through.
 *
 * Two askings mean two dismissals. They are tracked under separate keys, so
 * waving it away on the way in does not spend the one that comes after signing
 * in, and neither spends the other's month of quiet.
 *
 * It comes down over the header rather than pushing the page down, so nothing
 * on screen moves under a finger already reaching for it.
 */

/** What "not now" buys, per place it was said. A season later is fair. */
const DISMISSED_FOR_MS = 30 * 24 * 60 * 60 * 1_000;

/** One per side of the sign-in card. See the note above on why they are two. */
const DISMISSED_KEY = {
	in: "pool-link:install-dismissed:signed-in",
	out: "pool-link:install-dismissed:signed-out",
} as const;

export type InstallScope = keyof typeof DISMISSED_KEY;

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
		// making a fuss about — the banner is simply asked again next time.
	}
}

export function InstallPrompt({ scope }: { scope: InstallScope }) {
	const { canPrompt, manual, install } = useInstall();
	const online = useOnline();
	const key = DISMISSED_KEY[scope];
	// Dismissed until proven otherwise: storage cannot be read on the server or
	// on the render that matches it, and a banner that appeared for one frame
	// and then took itself away would be worse than one that waited a frame.
	const [dismissed, setDismissed] = useState(true);

	useEffect(() => {
		setDismissed(Date.now() - read(key) < DISMISSED_FOR_MS);
	}, [key]);

	function dismiss() {
		setDismissed(true);
		write(key, Date.now());
	}

	// Offline is the one moment this stays out of the way: the foot of the
	// screen already carries a warning, and the water on screen is old.
	if (dismissed || !online || !(canPrompt || manual)) return null;

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
				{/* p-0 undoes the indicator's own padding: it is sized for a stroke
				    glyph that needs air around it, and a plated tile brings its own. */}
				<Alert.Indicator className="shrink-0 p-0">
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
						Install the Pool Link App
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
									className="inline size-4 align-text-bottom text-foreground"
									role="img"
								/>
								{" then Add to Home Screen"}
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

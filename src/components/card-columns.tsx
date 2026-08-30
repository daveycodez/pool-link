import {
	Children,
	Fragment,
	isValidElement,
	useSyncExternalStore,
} from "react";

/** Matches the Tailwind breakpoints the layout is built on. */
const BREAKPOINTS: [query: string, columns: number][] = [
	["(min-width: 768px)", 2],
];

function subscribe(onChange: () => void) {
	const lists = BREAKPOINTS.map(([q]) => matchMedia(q));
	for (const l of lists) l.addEventListener("change", onChange);
	return () => {
		for (const l of lists) l.removeEventListener("change", onChange);
	};
}

const columnCount = () =>
	BREAKPOINTS.find(([q]) => matchMedia(q).matches)?.[1] ?? 1;

/**
 * How many columns to deal into. Measured rather than expressed in classes,
 * because the split happens in JavaScript: a column that CSS hides still holds
 * the cards dealt to it, so they would simply disappear at that width.
 *
 * One column until it is known, which is what a phone gets anyway — so the
 * first paint is right there, and only wider screens reflow once on mount.
 */
function useColumnCount() {
	return useSyncExternalStore(subscribe, columnCount, () => 1);
}

/**
 * The cards, with fragments opened up.
 *
 * Children.toArray counts a fragment as one child, so a component returning
 * several cards in one arrived as a single item — its whole group landing in
 * whichever column that item fell to, however many cards it held.
 */
function flatten(children: React.ReactNode): React.ReactNode[] {
	return Children.toArray(children).flatMap((child) =>
		isValidElement(child) && child.type === Fragment
			? flatten((child.props as { children?: React.ReactNode }).children)
			: child,
	);
}

/**
 * Cards laid out in columns, each only as tall as it needs to be.
 *
 * Not a grid: grid keeps rows, so a short card beside a tall one leaves the
 * space below it empty rather than letting the next card rise into it. Not CSS
 * multi-column either — that packs correctly but fills one column before the
 * next, so the second card lands beneath the first rather than beside it, and
 * the column break carries the preceding card's margin, which leaves the top
 * of later columns sitting low.
 *
 * Every column is an ordinary stack, so they start level and space evenly —
 * which is what CSS columns could not do.
 */
export function CardColumns({ children }: { children: React.ReactNode }) {
	const count = useColumnCount();
	const items = flatten(children);
	const columns: React.ReactNode[][] = Array.from({ length: count }, () => []);
	// Sequential rather than dealt: fill a column before starting the next, so
	// the columns read top-to-bottom like newspaper text. Split evenly by count,
	// with the remainder going to the earlier columns so the left is never
	// shorter than the right.
	const per = Math.ceil(items.length / count);
	items.forEach((child, i) => columns[Math.floor(i / per)]?.push(child));

	return (
		<div className="flex flex-col gap-4 md:flex-row md:items-start">
			{columns.map((column, i) => (
				<div
					className="flex min-w-0 flex-1 flex-col gap-4"
					// Position is the identity here: which column, not which card.
					// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
					key={i}
				>
					{column}
				</div>
			))}
		</div>
	);
}

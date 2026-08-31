import {
	Children,
	cloneElement,
	Fragment,
	isValidElement,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
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
function flatten(children: React.ReactNode, prefix = ""): React.ReactNode[] {
	return Children.toArray(children).flatMap((child, i) => {
		// Children.toArray numbers keys from .0 at every level, so recursing into
		// a fragment restarts the count and collides with the level above it.
		// The path down makes each one unique again.
		if (isValidElement(child) && child.type === Fragment) {
			const inner = (child.props as { children?: React.ReactNode }).children;
			return flatten(inner, `${prefix}${i}:`);
		}
		return isValidElement(child)
			? cloneElement(child, { key: `${prefix}${child.key ?? i}` })
			: child;
	});
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
const NONE: ReadonlySet<number> = new Set();

/**
 * Measured before paint where there is a document to measure, so the balance
 * is right on the first frame the user sees rather than a correction after it.
 */
const useMeasure =
	typeof document === "undefined" ? useEffect : useLayoutEffect;

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
	/**
	 * Which items drew nothing.
	 *
	 * Splitting on how many children there are counts the ones that decide, on
	 * their own, to render null — and half the settings rows do exactly that,
	 * hiding themselves when the panel names no model or the account holds one
	 * system. Eleven children with one of them blank was dealt six and five and
	 * then painted six and four, and the gap grows with however many happen to
	 * be hiding, which is not a number anything here can know in advance.
	 *
	 * So it is measured. A child that produced no element is one the columns
	 * should never have counted, and asking the DOM is the only way to find
	 * out — React offers no way to ask an element what it is about to render.
	 */
	const [blank, setBlank] = useState<ReadonlySet<number>>(NONE);
	const drawn = useRef<(HTMLSpanElement | null)[]>([]);

	useMeasure(() => {
		const found = new Set<number>();
		for (let i = 0; i < items.length; i++) {
			if (drawn.current[i]?.childElementCount === 0) found.add(i);
		}
		// Replaced only when it actually differs, or this would set state on
		// every render and never settle.
		setBlank((prev) =>
			prev.size === found.size && [...found].every((i) => prev.has(i))
				? prev
				: found,
		);
	});

	const shown = items.map((_, i) => i).filter((i) => !blank.has(i));
	const columns: number[][] = Array.from({ length: count }, () => []);
	// Sequential rather than dealt: fill a column before starting the next, so
	// the columns read top-to-bottom like newspaper text. Split evenly by what
	// is actually drawn, with the remainder going to the earlier columns so the
	// left is never shorter than the right.
	const per = Math.max(1, Math.ceil(shown.length / count));
	shown.forEach((item, i) => {
		columns[Math.floor(i / per)]?.push(item);
	});
	// The blank ones still have to be rendered — a row hides itself from inside,
	// so it has to be mounted to decide it should not be, and to change its mind
	// when its query lands. They add no height wherever they go.
	for (const i of blank) columns[count - 1]?.push(i);

	return (
		<div className="flex flex-col gap-4 md:flex-row md:items-start">
			{columns.map((column, i) => (
				<div
					className="flex min-w-0 flex-1 flex-col gap-4"
					// Position is the identity here: which column, not which card.
					// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
					key={i}
				>
					{column.map((n) => (
						// display:contents, so the card itself stays the flex item and
						// the column's gap still falls between cards. A real box here
						// would leave a gap where a hidden row used to be.
						<span
							className="contents"
							key={n}
							ref={(el) => {
								drawn.current[n] = el;
							}}
						>
							{items[n]}
						</span>
					))}
				</div>
			))}
		</div>
	);
}

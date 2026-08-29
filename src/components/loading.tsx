import { Spinner } from "@heroui/react";

/**
 * The single loading treatment. Fixed rather than in-flow so it lands dead
 * centre of the viewport wherever it is mounted — routes render it inside a
 * padded container, below the header.
 */
export function Loading() {
	return (
		<div className="fixed inset-0 flex items-center justify-center">
			<Spinner color="accent" size="lg" />
		</div>
	);
}

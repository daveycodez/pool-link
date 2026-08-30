import { NumberField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

/**
 * People tap steppers repeatedly, and the panel processes commands one at a
 * time over RS-485 — so send the value they settled on, not every value they
 * passed through.
 */
const DEBOUNCE_MS = 600;

export interface TempRange {
	min: number;
	max: number;
	step: number;
}

/**
 * Set-point bounds, from flz/iaqualink-py's own limits — the range the panel
 * accepts rather than a range that seemed sensible. It does not narrow these
 * per body or per set point: pool, spa and chill share one, and whole degrees
 * are all it takes.
 */
const RANGES: Record<"F" | "C", TempRange> = {
	F: { min: 34, max: 104, step: 1 },
	C: { min: 1, max: 40, step: 1 },
};

export function tempRange(celsius: boolean): TempRange {
	return RANGES[celsius ? "C" : "F"];
}

export function TempStepper({
	value,
	range,
	onCommit,
	className,
	label = "Target temperature",
}: {
	value: number;
	range: TempRange;
	onCommit: (temp: number) => void;
	className?: string;
	/**
	 * What a screen reader calls this. Everything else about the control is
	 * already unit-agnostic — a bounded integer, debounced to the value someone
	 * settles on — so the chlorinator's output percent reuses it wholesale, and
	 * only the announced name has to stop saying temperature.
	 */
	label?: string;
}) {
	// Held locally while taps are still coming in, so the number moves with
	// every press even though only the last one is sent.
	const [draft, setDraft] = useState<number | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Drop the draft once the panel reports what we sent, so later updates from
	// the poll are not masked by a stale local value.
	useEffect(() => {
		if (draft !== null && draft === value) setDraft(null);
	}, [draft, value]);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return (
		<NumberField
			aria-label={label}
			className={className}
			isDisabled={!Number.isFinite(value)}
			maxValue={range.max}
			minValue={range.min}
			onChange={(next) => {
				setDraft(next);
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => onCommit(next), DEBOUNCE_MS);
			}}
			step={range.step}
			value={draft ?? value}
			variant="secondary"
		>
			<NumberField.Group>
				<NumberField.DecrementButton />
				<NumberField.Input className="w-14 text-center" />
				<NumberField.IncrementButton />
			</NumberField.Group>
		</NumberField>
	);
}

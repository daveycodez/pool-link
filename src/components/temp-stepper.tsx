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
 * Set-point bounds. The panel advertises its scale but not its limits, so these
 * stay constants — the Celsius pair is the Fahrenheit pair converted, rounded
 * inward to whole degrees so neither end can land outside what the panel takes.
 */
const RANGES: Record<"F" | "C", { spa: TempRange; pool: TempRange }> = {
	F: {
		spa: { min: 98, max: 104, step: 1 },
		pool: { min: 78, max: 88, step: 2 },
	},
	C: {
		spa: { min: 37, max: 40, step: 1 },
		pool: { min: 26, max: 31, step: 1 },
	},
};

export function tempRange(body: "spa" | "pool", celsius: boolean): TempRange {
	return RANGES[celsius ? "C" : "F"][body];
}

export function TempStepper({
	value,
	range,
	onCommit,
	className,
}: {
	value: number;
	range: TempRange;
	onCommit: (temp: number) => void;
	className?: string;
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
			aria-label="Target temperature"
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

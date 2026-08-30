import { NumberField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

/**
 * People tap steppers repeatedly, and the panel processes commands one at a
 * time over RS-485 — so send the value they settled on, not every value they
 * passed through.
 */
const DEBOUNCE_MS = 600;

/** Ranges the panel accepts, and the granularity it steps in. */
export const SPA_RANGE = { min: 98, max: 104, step: 1 };
export const POOL_RANGE = { min: 78, max: 88, step: 2 };

export function TempStepper({
	value,
	range,
	onCommit,
	className,
}: {
	value: number;
	range: { min: number; max: number; step: number };
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

import { Card } from "@heroui/react";
import { ArrowDownToLine, ArrowUpToLine, Snowflake, Timer } from "lucide-react";
import { SettingsRow } from "#/components/settings-rows";
import type { VspDefinition, VspDefinitionField } from "#/lib/aqualink/client";
import { useSetPumpDefinition } from "#/lib/queries";
import { TempStepper } from "./temp-stepper";

/**
 * The widest speed envelope this app will let anyone set.
 *
 * Every slot on this panel reports 600 to 3450 — the installed pumps and, more
 * usefully, the empty ones, which carry the factory default for their model
 * rather than anything an owner chose. That makes it the pump's own full range
 * rather than a figure that seemed reasonable. Nothing in the protocol states
 * an absolute limit, so a pump capable of more than 3450 would be held to it
 * here: a limitation rather than a hazard, and one that errs toward asking the
 * motor for less than it can do rather than more.
 */
const SPEED_FLOOR = 600;
const SPEED_CEILING = 3450;

/**
 * Priming runs the pump hard to clear air from the basket before the filter
 * cycle proper, and then stops — so its length is bounded by patience and the
 * cost of running dry, not by anything the panel publishes. This pool's is
 * three minutes. The bound here is an app-side guard against a typo turning
 * "prime for a moment" into half an hour of the pump at full speed, not a
 * protocol limit, and it is deliberately generous rather than tight.
 */
const PRIME_MINUTES_MAX = 30;

/**
 * Wide enough for four digits and the space either side of them. Speeds run to
 * 3450 where the stepper's own default is cut for a three-digit temperature,
 * and at that width the value touches the increment buttons. The priming time
 * is minutes and keeps the narrow default.
 */
const SPEED_INPUT = "w-20 text-center";

export function PumpMasterSpeeds({
	serial,
	definition,
	unit,
	step,
}: {
	serial: string;
	definition: VspDefinition;
	unit: string;
	step: number;
}) {
	const set = useSetPumpDefinition(serial);
	const min = definition.min ?? SPEED_FLOOR;
	const max = definition.max ?? SPEED_CEILING;

	const commit =
		(
			field: Extract<
				VspDefinitionField,
				| "min_speed"
				| "max_speed"
				| "prime_speed"
				| "prime_duration"
				| "freezeprotect_speed"
			>,
		) =>
		(value: number) =>
			set.mutate({ slotId: definition.slotId, field, value });

	return (
		<div className="space-y-4">
			<h2 className="px-1 text-sm font-medium text-muted">Master Speeds</h2>

			{/* Min and max bound every feature speed above, so they are edited
			    against each other rather than against the pump's own range —
			    a minimum above the maximum is the one combination the panel has
			    no sensible reading of. */}
			<SettingsRow Icon={ArrowDownToLine} title="Minimum">
				<TempStepper
					inputClassName={SPEED_INPUT}
					label={`Minimum speed in ${unit}`}
					onCommit={commit("min_speed")}
					range={{ min: SPEED_FLOOR, max: max - step, step }}
					value={min}
				/>
			</SettingsRow>

			<SettingsRow Icon={ArrowUpToLine} title="Maximum">
				<TempStepper
					inputClassName={SPEED_INPUT}
					label={`Maximum speed in ${unit}`}
					onCommit={commit("max_speed")}
					range={{ min: min + step, max: SPEED_CEILING, step }}
					value={max}
				/>
			</SettingsRow>

			<SettingsRow Icon={Timer} title="Priming speed">
				<TempStepper
					inputClassName={SPEED_INPUT}
					label={`Priming speed in ${unit}`}
					onCommit={commit("prime_speed")}
					range={{ min, max, step }}
					value={definition.primeSpeed ?? max}
				/>
			</SettingsRow>

			<SettingsRow Icon={Timer} title="Priming time">
				<TempStepper
					label="Priming time in minutes"
					onCommit={commit("prime_duration")}
					range={{ min: 0, max: PRIME_MINUTES_MAX, step: 1 }}
					value={definition.primeDurationMinutes ?? 0}
				/>
			</SettingsRow>

			<SettingsRow Icon={Snowflake} title="Freeze protection">
				<TempStepper
					inputClassName={SPEED_INPUT}
					label={`Freeze protection speed in ${unit}`}
					onCommit={commit("freezeprotect_speed")}
					range={{ min, max, step }}
					value={definition.freezeProtectSpeed ?? min}
				/>
			</SettingsRow>

			<Card>
				<Card.Description>
					The panel runs these on its own initiative. Priming clears the basket
					before a filter cycle; freeze protection turns the pump over when the
					air temperature drops far enough to put the plumbing at risk. Minimum
					and maximum bound every feature speed above.
				</Card.Description>
			</Card>
		</div>
	);
}

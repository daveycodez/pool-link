import { Card, Chip, Label, Slider, Switch } from "@heroui/react";
import {
	Droplets,
	Flame,
	Lightbulb,
	SlidersHorizontal,
	Zap,
} from "lucide-react";
import { DIMMER_STEP } from "#/lib/aqualink/enums";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { isStandby } from "#/lib/use-pool";
import { presetIcon } from "./preset-icons";

/** Accent while the device is running, muted when it's idle. */
export function IconCircle({
	on,
	children,
}: {
	on: boolean;
	children: React.ReactNode;
}) {
	return (
		<div
			className={`flex size-9 items-center justify-center rounded-full bg-surface-secondary ${
				on ? "text-accent" : "text-muted"
			}`}
		>
			{children}
		</div>
	);
}

/**
 * The label first — a relay is named from the panel's own preset list, so the
 * name says what the equipment is in a way its position never could. Failing
 * that, the device's kind, which the protocol supplies. Failing both, the bolt.
 */
export function DeviceIcon({ device }: { device: PoolDevice }) {
	const Preset = presetIcon(device.label);
	if (Preset) return <Preset className="size-4" />;

	switch (device.kind) {
		case "light":
			return <Lightbulb className="size-4" />;
		case "dimmer":
			return <SlidersHorizontal className="size-4" />;
		case "pump":
			return <Droplets className="size-4" />;
		case "climate":
			return <Flame className="size-4" />;
		default:
			return <Zap className="size-4" />;
	}
}

export function EquipmentRow({
	device,
	onToggle,
	onDim,
}: {
	device: PoolDevice;
	onToggle: (on: boolean) => void;
	/**
	 * Set a dimming relay's brightness. Passed only for a relay the panel typed
	 * as one, so every other row takes the path it always did — which is most
	 * rows, and every row on a pad with no dimmer wired.
	 */
	onDim?: (level: number) => void;
}) {
	const dim = device.kind === "dimmer" ? onDim : undefined;

	const label = (
		<div className="flex items-center gap-4">
			<IconCircle on={device.on}>
				<DeviceIcon device={device} />
			</IconCircle>
			<div>
				<Card.Title>{device.label}</Card.Title>
				{/* Redundant beside a slider, which prints its own value. */}
				{device.dimLevel !== null && !dim ? (
					<p className="text-xs text-muted">{device.dimLevel}%</p>
				) : null}
			</div>
		</div>
	);

	const control = (
		<div className="flex items-center gap-3">
			{/* A heater the panel calls enabled rather than on: the switch has
			    two positions and this is the third state, so it is said beside
			    it rather than folded into it. */}
			{isStandby(device) ? (
				<Chip color="warning" size="sm" variant="soft">
					Standby
				</Chip>
			) : null}
			<Switch
				aria-label={device.label}
				isSelected={device.on}
				onChange={(on: boolean) => onToggle(on)}
			>
				<Switch.Content>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch.Content>
			</Switch>
		</div>
	);

	if (!dim)
		return (
			<Card className="flex-row items-center justify-between gap-4">
				{label}
				{control}
			</Card>
		);

	return (
		<Card>
			<div className="flex items-center justify-between gap-4">
				{label}
				{control}
			</div>

			{/* Only while the relay is closed, so the switch stays the single way to
			    turn it off — the same shape the ICL zone card uses, and the shape the
			    pad itself uses: Jandy's manual has the arrows dim between 25% and
			    100% and "press AUX to turn off". Nothing is sent when the switch goes
			    back on, for the reason the same page gives — "when light is turned
			    back on, it will automatically return to the brightness last set" — so
			    the panel's own memory is left to do that rather than overwritten.

			    A slider rather than four buttons because the app already spells
			    brightness this way one card over, and because the quarters are one
			    range the relay steps through rather than four named settings — the
			    detents say that, where a segmented control would read as modes.
			    Stepped by 25 so the thumb can only land where the relay can. */}
			{device.on ? (
				<Slider
					maxValue={100}
					// Off belongs to the switch, so the lowest the slider goes is the
					// dimmest the relay can be while still on.
					minValue={DIMMER_STEP}
					// Only on release: dragging fires continuously, and each report
					// would be another command the panel works through in turn.
					onChangeEnd={(v) => dim(Number(v))}
					step={DIMMER_STEP}
					// A relay that is on but reports nothing, or reports a level the
					// slider has no detent for, still has to render somewhere.
					value={Math.max(DIMMER_STEP, device.dimLevel ?? 100)}
				>
					<div className="flex items-baseline justify-between gap-2">
						<Label className="text-xs font-medium uppercase tracking-widest text-muted">
							Brightness
						</Label>
						<Slider.Output className="text-xs text-muted tabular-nums" />
					</div>
					<Slider.Track>
						<Slider.Fill />
						<Slider.Thumb />
					</Slider.Track>
				</Slider>
			) : null}
		</Card>
	);
}

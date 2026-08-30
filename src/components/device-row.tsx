import { Card, Switch } from "@heroui/react";
import {
	Droplets,
	Flame,
	Lightbulb,
	SlidersHorizontal,
	Zap,
} from "lucide-react";
import type { PoolDevice } from "#/lib/iaqualink/types";
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
}: {
	device: PoolDevice;
	onToggle: (on: boolean) => void;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={device.on}>
					<DeviceIcon device={device} />
				</IconCircle>
				<div>
					<Card.Title>{device.label}</Card.Title>
					{device.dimLevel !== null ? (
						<p className="text-xs text-muted">{device.dimLevel}%</p>
					) : null}
				</div>
			</div>
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
		</Card>
	);
}

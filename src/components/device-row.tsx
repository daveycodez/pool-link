import { Card, Switch } from "@heroui/react";
import {
	Droplets,
	Flame,
	Lightbulb,
	SlidersHorizontal,
	Zap,
} from "lucide-react";
import type { PoolDevice } from "#/lib/iaqualink/types";

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
 * Icons come from the device's kind, which the protocol supplies. A relay is
 * whatever the owner wired to it, so anything unrecognised gets the bolt
 * rather than an icon guessed from its position.
 */
export function DeviceIcon({ device }: { device: PoolDevice }) {
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

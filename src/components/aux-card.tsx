import { Card, Switch } from "@heroui/react";
import { Zap } from "lucide-react";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { IconCircle } from "./device-row";
import { DeviceSpeed } from "./pump-speeds";

/**
 * One aux relay, whatever it happens to be. The panel supplies the label, and
 * the speed control appears only when a variable-speed pump drives this relay
 * — so a pool with different equipment gets different cards without this file
 * knowing anything about jets, waterfalls or cleaners.
 */
export function AuxCard({
	serial,
	device,
	onToggle,
}: {
	serial: string;
	device: PoolDevice;
	onToggle: (on: boolean) => void;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={device.on}>
					<Zap className="size-4" />
				</IconCircle>
				<Card.Title>{device.label}</Card.Title>
			</div>

			<div className="flex items-center gap-3">
				<DeviceSpeed
					className="w-32"
					deviceName={device.name}
					serial={serial}
				/>
				<Switch
					aria-label={device.label}
					isSelected={device.on}
					onChange={onToggle}
				>
					<Switch.Content>
						<Switch.Control>
							<Switch.Thumb />
						</Switch.Control>
					</Switch.Content>
				</Switch>
			</div>
		</Card>
	);
}

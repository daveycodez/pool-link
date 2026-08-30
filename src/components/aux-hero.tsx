import { Button, Card } from "@heroui/react";
import { Power } from "lucide-react";
import { pumpForDevice } from "#/lib/aqualink/client";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useSetVspSpeed, useVspPumps } from "#/lib/queries";
import { DeviceIcon } from "./device-row";
import { presetIcon } from "./preset-icons";
import { TrackSwitch } from "./track-switch";

/**
 * One aux relay, whatever it happens to be. Same shape as the light hero: the
 * label and its switch on top, and underneath whatever extra control the relay
 * turns out to support. The panel supplies the label, and the speeds appear
 * only when a variable-speed pump drives this relay — so this file knows
 * nothing about jets, waterfalls or cleaners.
 */
export function AuxHero({
	serial,
	device,
	onToggle,
}: {
	serial: string;
	device: PoolDevice;
	onToggle: (on: boolean) => void;
}) {
	const { data: pumps } = useVspPumps(serial);
	const setSpeed = useSetVspSpeed(serial);
	const pump = pumpForDevice(pumps, device.name);
	// The relay's own icon in the thumb, so the switch says what it switches.
	// Unnamed relays have nothing to show, and fall back to a power symbol.
	const Thumb = presetIcon(device.label) ?? Power;
	const active = pump?.speeds.find((s) => s.active);

	return (
		<Card className="p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						<span className="text-accent">
							<DeviceIcon device={device} />
						</span>
						{device.label}
					</div>
				</div>

				<TrackSwitch
					device={device}
					offIcon={Thumb}
					offLabel="Off"
					onIcon={Thumb}
					onLabel="On"
					onToggle={(_d, on) => onToggle(on)}
				/>
			</div>

			{/* Two per row, matching the light hero — speed names vary in length,
			    and equal widths keep the block from looking ragged. */}
			{pump ? (
				<div className="grid grid-cols-2 gap-2">
					{pump.speeds.map((speed) => (
						<Button
							className="w-full justify-start text-xs"
							key={speed.id}
							onPress={() =>
								setSpeed.mutate({ pumpId: pump.pumpId, speedId: speed.id })
							}
							size="sm"
							variant={
								speed.id === active?.id && device.on ? "primary" : "tertiary"
							}
						>
							{speed.name}
							<span className="ml-auto tabular-nums opacity-60">
								{speed.rpm}
							</span>
						</Button>
					))}
				</div>
			) : null}
		</Card>
	);
}
